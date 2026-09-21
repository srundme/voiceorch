/**
 * WebRTC AEC3 for SnapServe 8 kHz telephony (VoBiz LINEAR16 and other PSTN).
 *
 * Far-end reference = PCM (or μ-law decoded to PCM) we send on the media WS —
 * TTS, ambient, and keepalive silence. Near-end = inbound caller PCM, run
 * before Quail VF / STT / barge energy.
 *
 * Open-source: @ennuicastr/webrtcaec3.js (WASM port of Chromium WebRTC AEC3,
 * BSD-3-Clause). Core sample rate is 48 kHz; we pass sampleRateIn/Out 8000 so
 * VoBiz 20 ms frames stay aligned without a separate resampler.
 *
 * Env:
 *   AEC3_ENABLED          — default on. Set 0/false/off to disable.
 *   AEC3_STREAM_DELAY_MS  — initial render→capture delay hint in ms (default 100).
 *   AEC3_ADAPTIVE_DELAY   — default on. Estimates delay per call from energy correlation.
 */

import { createRequire } from "node:module";
import { logger } from "../lib/logger.js";
import { voiceCanaryBaseFields, type VoiceCanaryRouteMeta } from "./voice-canary.js";

type Aec3Module = {
  AEC3: new (
    sampleRate: number,
    renderNumChannels: number,
    captureNumChannels: number,
  ) => Aec3Instance;
};

type Aec3Instance = {
  free: () => void;
  setAudioBufferDelay: (delayMs: number) => void;
  analyze: (data: Float32Array[], opts?: { sampleRateIn?: number }) => void;
  processSize: (
    data: Float32Array[],
    opts?: { sampleRateIn?: number; sampleRateOut?: number },
  ) => number;
  process: (
    out: Float32Array[],
    data: Float32Array[],
    opts?: { sampleRateIn?: number; sampleRateOut?: number },
  ) => void;
};

/** AEC3 native rate required by the WASM port (8/16 kHz are I/O only). */
const AEC3_CORE_RATE = 48000;
const TELEPHONY_RATE = 8000;
const FRAME_MS = 20;

const IO_OPTS = { sampleRateIn: TELEPHONY_RATE, sampleRateOut: TELEPHONY_RATE } as const;

/** Realistic VoBiz render→capture lag. */
export const AEC3_DELAY_MIN_MS = 40;
export const AEC3_DELAY_MAX_MS = 800;
/** Smooth updates — avoid oscillation on noisy correlation. */
export const AEC3_DELAY_STEP_MS = 15;
/** Minimum Pearson peak to accept an estimate. */
export const AEC3_MIN_CORR = 0.4;
/** Keep treating render as "active" briefly after last loud far frame (carrier jitter). */
export const AEC3_RENDER_ACTIVE_TAIL_MS = 300;

const requireFromHere = createRequire(import.meta.url);

let modulePromise: Promise<Aec3Module | null> | null = null;
let loadError: string | null = null;

function envFlagOn(raw: string | undefined, defaultOn: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return defaultOn;
  const v = raw.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  return defaultOn;
}

/** AEC3 is on by default for SnapServe PSTN; set AEC3_ENABLED=0 to disable. */
export function aec3Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envFlagOn(env["AEC3_ENABLED"], true);
}

export function aec3StreamDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env["AEC3_STREAM_DELAY_MS"] ?? 100);
  if (!Number.isFinite(n)) return 100;
  return Math.min(AEC3_DELAY_MAX_MS, Math.max(AEC3_DELAY_MIN_MS, Math.floor(n)));
}

function pcm16ToFloat32(pcm: Buffer): Float32Array {
  const n = Math.floor(pcm.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = pcm.readInt16LE(i * 2) / 32768;
  return out;
}

function float32ToPcm16(samples: Float32Array, byteLength: number): Buffer {
  const n = Math.floor(byteLength / 2);
  const out = Buffer.alloc(byteLength);
  const copy = Math.min(n, samples.length);
  for (let i = 0; i < copy; i++) {
    const s = Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767);
    out.writeInt16LE(s, i * 2);
  }
  return out;
}

async function loadModule(): Promise<Aec3Module | null> {
  if (!modulePromise) {
    modulePromise = (async () => {
      let factory: (() => Promise<Aec3Module>) | undefined;
      try {
        factory = requireFromHere("@ennuicastr/webrtcaec3.js") as () => Promise<Aec3Module>;
      } catch {
        const mod = await import("@ennuicastr/webrtcaec3.js");
        factory =
          (typeof mod === "function" ? mod : (mod as { default?: unknown }).default) as
            | (() => Promise<Aec3Module>)
            | undefined;
      }
      if (typeof factory !== "function") {
        loadError = "webrtcaec3.js export is not a factory";
        return null;
      }
      return factory();
    })().catch((err) => {
      loadError = err instanceof Error ? err.message : String(err);
      modulePromise = null;
      return null;
    });
  }
  return modulePromise;
}

/** Warm the WASM module once per process (optional startup). */
export async function ensureAec3Module(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  if (!aec3Enabled()) return { ok: false, reason: "AEC3_ENABLED off" };
  const m = await loadModule();
  if (!m) return { ok: false, reason: loadError ?? "AEC3 module load failed" };
  return { ok: true };
}

export type DelayEstimate = { lagFrames: number; score: number };

export type Aec3Diagnostics = {
  delayMs: number;
  adaptiveDelay: boolean;
  renderActive: boolean;
  doubleTalk: boolean;
  farEnergy: number;
  rawNearEnergy: number;
};

function logAecCanary(
  callId: string,
  event: string,
  fields: Record<string, unknown>,
  routeMeta?: Partial<VoiceCanaryRouteMeta>,
): void {
  try {
    const base = voiceCanaryBaseFields({
      callId,
      mediaEpoch: routeMeta?.mediaEpoch ?? 0,
      carrier: routeMeta?.carrier ?? "unknown",
      route: routeMeta?.route ?? String(callId),
    });
    logger.info({ ...base, event, ...fields }, event);
  } catch {
    /* logging must never break audio */
  }
}

/**
 * Per-call AEC3 canceller. Sticky to one audio worker (same callId → same worker)
 * so analyze/process share filter state with far-end FEED_RENDER messages.
 *
 * Adaptive delay guardrails (canary-safe):
 *   - only update while render (TTS) was recently active
 *   - skip during double-talk (raw near energy, not post-AEC)
 *   - require correlation ≥ AEC3_MIN_CORR
 *   - clamp [40, 800] ms, step ≤ 15 ms
 *   - reset() on mediaEpoch change
 * Rollback: set AEC3_ADAPTIVE_DELAY=0 to freeze AEC3_STREAM_DELAY_MS.
 */
export class Aec3CallCanceller {
  private aec: Aec3Instance | null = null;
  private mod: Aec3Module | null = null;
  private ready = false;
  private failed = false;
  private initPromise: Promise<boolean> | null = null;
  private delayMs: number;
  private readonly adaptiveDelay: boolean;
  /** Far-end (render) frame energy — always from analyzePcm8k. */
  private readonly farEnergy: number[] = [];
  /**
   * Near-end frame energy from *raw inbound* PCM, before AEC3 process.
   * Double-talk and delay correlation must NOT use post-AEC audio — poor
   * convergence would hide the caller and allow another bad delay update.
   */
  private readonly rawNearEnergy: number[] = [];
  private framesSinceEstimate = 0;
  private lastLoudRenderAt = 0;
  private lastLoggedDelayAt = 0;
  private canaryMediaEpoch = 0;
  private canaryCarrier = "unknown";
  private canaryRoute: string;
  private static readonly ENERGY_RING = 100; // 2 s @ 20 ms
  private static readonly ESTIMATE_EVERY = 50; // ~1 s
  private static readonly FAR_ACTIVE_ENERGY = 0.0004; // ~RMS 0.02
  private static readonly NEAR_DT_ENERGY = 0.0008; // caller speech-ish (raw)

  constructor(
    private readonly callId: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.delayMs = aec3StreamDelayMs(env);
    this.adaptiveDelay = envFlagOn(env["AEC3_ADAPTIVE_DELAY"], true);
    this.canaryRoute = callId;
  }

  /** Keep AEC canary lines aligned with pipeline mediaEpoch / carrier / route. */
  setCanaryRouteMeta(meta: Partial<VoiceCanaryRouteMeta>): void {
    if (typeof meta.mediaEpoch === "number" && Number.isFinite(meta.mediaEpoch)) {
      this.canaryMediaEpoch = Math.max(0, Math.floor(meta.mediaEpoch));
    }
    if (meta.carrier && meta.carrier.trim()) this.canaryCarrier = meta.carrier.trim();
    if (meta.route && meta.route.trim()) this.canaryRoute = meta.route.trim();
  }

  private routeMeta(): Partial<VoiceCanaryRouteMeta> {
    return {
      callId: this.callId,
      mediaEpoch: this.canaryMediaEpoch,
      carrier: this.canaryCarrier,
      route: this.canaryRoute,
    };
  }

  async init(): Promise<boolean> {
    if (this.ready) return true;
    if (this.failed) return false;
    if (!aec3Enabled(this.env)) {
      this.failed = true;
      return false;
    }
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const mod = await loadModule();
        if (!mod) {
          this.failed = true;
          return false;
        }
        try {
          this.mod = mod;
          this.aec = new mod.AEC3(AEC3_CORE_RATE, 1, 1);
          this.aec.setAudioBufferDelay(this.delayMs);
          this.ready = true;
          return true;
        } catch {
          this.failed = true;
          this.aec = null;
          return false;
        }
      })();
    }
    return this.initPromise;
  }

  /**
   * Far-end: exact bytes about to hit VoBiz playAudio (or decoded μ-law).
   * Keep calling for every transmitted frame until playback drain ends — including
   * frames already queued after TTS generation was cancelled.
   */
  analyzePcm8k(pcm8k: Buffer): void {
    if (!this.ready || !this.aec || pcm8k.length < 2) return;
    const samples = pcm16ToFloat32(pcm8k);
    if (samples.length === 0) return;
    const e = frameEnergy(samples);
    this.pushEnergy(this.farEnergy, e);
    if (e >= Aec3CallCanceller.FAR_ACTIVE_ENERGY) {
      this.lastLoudRenderAt = Date.now();
    }
    this.aec.analyze([samples], IO_OPTS);
  }

  /** Near-end: cancel echo; returns same byte length as input for STT framing. */
  processPcm8k(pcm8k: Buffer): Buffer {
    if (!this.ready || !this.aec || pcm8k.length < 2) return pcm8k;
    const samples = pcm16ToFloat32(pcm8k);
    if (samples.length === 0) return pcm8k;
    // Capture raw near energy BEFORE AEC3 (see rawNearEnergy comment).
    this.pushEnergy(this.rawNearEnergy, frameEnergy(samples));
    this.maybeAdaptDelay();
    const ch = [samples];
    const sz = this.aec.processSize(ch, IO_OPTS);
    const out = [new Float32Array(Math.max(sz, 1))];
    this.aec.process(out, ch, IO_OPTS);
    return float32ToPcm16(out[0]!, pcm8k.length);
  }

  /** Canary / ops snapshot — safe to log; no PCM. */
  getDiagnostics(): Aec3Diagnostics {
    return {
      delayMs: this.delayMs,
      adaptiveDelay: this.adaptiveDelay,
      renderActive: this.renderRecentlyActive(),
      doubleTalk: this.inDoubleTalk(),
      farEnergy: this.farEnergy[this.farEnergy.length - 1] ?? 0,
      rawNearEnergy: this.rawNearEnergy[this.rawNearEnergy.length - 1] ?? 0,
    };
  }

  /**
   * New VoBiz media socket / mediaEpoch — drop correlation history and recreate
   * the AEC3 instance so a stale delay does not poison the new path.
   */
  reset(): void {
    this.farEnergy.length = 0;
    this.rawNearEnergy.length = 0;
    this.framesSinceEstimate = 0;
    this.lastLoudRenderAt = 0;
    this.delayMs = aec3StreamDelayMs(this.env);
    if (!this.mod) return;
    try {
      this.aec?.free();
    } catch {
      /* ignore */
    }
    try {
      this.aec = new this.mod.AEC3(AEC3_CORE_RATE, 1, 1);
      this.aec.setAudioBufferDelay(this.delayMs);
      this.ready = true;
      this.failed = false;
      // Epoch reset canary event is owned by session.retargetAudioOut (single line).
    } catch {
      this.aec = null;
      this.ready = false;
      this.failed = true;
    }
  }

  private pushEnergy(ring: number[], e: number): void {
    ring.push(e);
    if (ring.length > Aec3CallCanceller.ENERGY_RING) ring.shift();
  }

  private renderRecentlyActive(): boolean {
    if (this.lastLoudRenderAt <= 0) return false;
    return Date.now() - this.lastLoudRenderAt <= AEC3_RENDER_ACTIVE_TAIL_MS;
  }

  /** Far loud + raw-near loud at once → double-talk; do not retune delay. */
  private inDoubleTalk(): boolean {
    const far = this.farEnergy[this.farEnergy.length - 1] ?? 0;
    const near = this.rawNearEnergy[this.rawNearEnergy.length - 1] ?? 0;
    return far >= Aec3CallCanceller.FAR_ACTIVE_ENERGY
      && near >= Aec3CallCanceller.NEAR_DT_ENERGY;
  }

  private maybeAdaptDelay(): void {
    if (!this.adaptiveDelay || !this.aec) return;
    this.framesSinceEstimate++;
    if (this.framesSinceEstimate < Aec3CallCanceller.ESTIMATE_EVERY) return;
    this.framesSinceEstimate = 0;

    const renderActive = this.renderRecentlyActive();
    const doubleTalk = this.inDoubleTalk();
    if (!renderActive || doubleTalk) return;

    const estimate = estimateDelayFrames(this.farEnergy, this.rawNearEnergy, AEC3_MIN_CORR);
    if (estimate == null) return;

    const rawMs = Math.round(estimate.lagFrames * FRAME_MS);
    const target = Math.min(AEC3_DELAY_MAX_MS, Math.max(AEC3_DELAY_MIN_MS, rawMs));
    const delta = Math.max(-AEC3_DELAY_STEP_MS, Math.min(AEC3_DELAY_STEP_MS, target - this.delayMs));
    const next = this.delayMs + delta;
    if (Math.abs(next - this.delayMs) < 5) return;
    const prev = this.delayMs;
    this.delayMs = next;
    try {
      this.aec.setAudioBufferDelay(this.delayMs);
    } catch {
      /* ignore */
    }
    const now = Date.now();
    if (now - this.lastLoggedDelayAt >= 500) {
      this.lastLoggedDelayAt = now;
      logAecCanary(this.callId, "aec3_delay_adjust", {
        delayBeforeMs: prev,
        delayAfterMs: this.delayMs,
        targetMs: target,
        corrScore: Number(estimate.score.toFixed(3)),
        lagFrames: estimate.lagFrames,
        renderActive: true,
        doubleTalk: false,
      }, this.routeMeta());
    }
  }

  dispose(): void {
    try {
      this.aec?.free();
    } catch {
      /* ignore */
    }
    this.aec = null;
    this.mod = null;
    this.ready = false;
    this.failed = false;
    this.initPromise = null;
    this.farEnergy.length = 0;
    this.rawNearEnergy.length = 0;
  }
}

function frameEnergy(samples: Float32Array): number {
  let e = 0;
  for (let i = 0; i < samples.length; i++) e += samples[i]! * samples[i]!;
  return e / Math.max(1, samples.length);
}

/**
 * Cross-correlate near energy against far energy; return lag in frames where
 * near lags far (echo delay). null when signal is too weak or score too low.
 */
export function estimateDelayFrames(
  far: number[],
  near: number[],
  minCorr: number = AEC3_MIN_CORR,
): DelayEstimate | null {
  if (far.length < 20 || near.length < 20) return null;
  const n = Math.min(far.length, near.length);
  const farSlice = far.slice(far.length - n);
  const nearSlice = near.slice(near.length - n);
  let farMean = 0;
  let nearMean = 0;
  for (let i = 0; i < n; i++) {
    farMean += farSlice[i]!;
    nearMean += nearSlice[i]!;
  }
  farMean /= n;
  nearMean /= n;
  if (farMean < 1e-6 || nearMean < 1e-6) return null;

  let bestLag = 0;
  let bestScore = -Infinity;
  const maxLag = Math.min(Math.floor(AEC3_DELAY_MAX_MS / FRAME_MS), Math.floor(n / 2));
  for (let lag = 2; lag <= maxLag; lag++) {
    let num = 0;
    let denF = 0;
    let denN = 0;
    const count = n - lag;
    for (let i = 0; i < count; i++) {
      const f = farSlice[i]! - farMean;
      const c = nearSlice[i + lag]! - nearMean;
      num += f * c;
      denF += f * f;
      denN += c * c;
    }
    const den = Math.sqrt(denF * denN);
    if (den < 1e-9) continue;
    const score = num / den;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestScore < minCorr) return null;
  return { lagFrames: bestLag, score: bestScore };
}

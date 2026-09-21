/**
 * Audio worker pool — manages a fixed set of worker threads for CPU-intensive
 * audio processing (AEC3, mulaw decode, Quail VF, upsampling, VAD).
 *
 * Pool size: max(2, cpuCount - 1).
 *
 * Routing: sticky callId → worker. This guarantees:
 *   1. WebRTC AEC3 far-end (FEED_RENDER) and near-end (PROCESS_*) share state.
 *   2. ai-coustics Quail VF processor state stays on the right worker.
 *   3. Chunks resolve in the order they were posted (FIFO per call on that worker).
 */

import { Worker } from "worker_threads";
import { cpus } from "os";
import { randomBytes } from "crypto";
import { logger } from "../lib/logger.js";

/**
 * Cap the worker pool. Railway (and other hosts) often report a large shared
 * CPU count; spawning cpus()-1 workers at boot can OOM the container right
 * after "Server listening", so /api/healthz never stays up.
 * Override with AUDIO_POOL_SIZE when you intentionally want a larger pool.
 */
const AUDIO_POOL_MAX = 8;
export function resolveAudioPoolSize(
  env: NodeJS.ProcessEnv = process.env,
  cpuCount: number = cpus().length,
): number {
  const raw = env["AUDIO_POOL_SIZE"];
  if (raw !== undefined && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.min(64, Math.floor(n));
  }
  return Math.min(AUDIO_POOL_MAX, Math.max(2, cpuCount - 1));
}
const POOL_SIZE = resolveAudioPoolSize();

export interface AudioProcessResult {
  pcm8k: Buffer;
  pcm16k: Buffer;
  hasSpeech: boolean;
  /** Pre-gate / pre-AEC frame RMS. Used to reject far-field bystanders. */
  rawRms: number;
  /** Optional canary stage PCM (VOICE_CANARY_AUDIO=1). */
  canary?: {
    rawPcm8k: Buffer;
    postAecPcm8k: Buffer;
    postQuailPcm8k: Buffer;
    aec?: {
      delayMs: number;
      renderActive: boolean;
      doubleTalk: boolean;
      adaptiveDelay: boolean;
    };
  };
}

interface WorkerResponse {
  id: string;
  pcm8k?: ArrayBuffer;
  pcm16kAb?: ArrayBuffer;
  hasSpeech?: boolean;
  rawRms?: number;
  canaryRaw?: ArrayBuffer;
  canaryPostAec?: ArrayBuffer;
  canaryPostQuail?: ArrayBuffer;
  aecDelayMs?: number;
  aecRenderActive?: boolean;
  aecDoubleTalk?: boolean;
  aecAdaptiveDelay?: boolean;
  error?: string;
}

interface Pending {
  timer: ReturnType<typeof setTimeout>;
  resolve: (r: AudioProcessResult) => void;
  reject:  (e: Error) => void;
}

export class AudioWorkerThread {
  private worker!: Worker;
  private healthy = false;
  private restarts = 0;
  private pending = new Map<string, Pending>();

  /** Number of in-flight requests on this worker — used for load-based routing. */
  get pendingCount(): number { return this.pending.size; }

  constructor(private workerUrl: URL) { this.start(); }

  private start(): void {
    const worker = this.worker = new Worker(this.workerUrl);
    this.healthy = true;
    this.worker.on("message", (msg: WorkerResponse) => {
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.error || !msg.pcm8k || !msg.pcm16kAb) {
        p.reject(new Error(msg.error ?? "Audio worker returned empty audio"));
        return;
      }
      p.resolve({
        pcm8k:    Buffer.from(msg.pcm8k),
        pcm16k:   Buffer.from(msg.pcm16kAb),
        hasSpeech: msg.hasSpeech ?? false,
        rawRms: msg.rawRms ?? 0,
        canary: msg.canaryRaw && msg.canaryPostAec && msg.canaryPostQuail
          ? {
              rawPcm8k: Buffer.from(msg.canaryRaw),
              postAecPcm8k: Buffer.from(msg.canaryPostAec),
              postQuailPcm8k: Buffer.from(msg.canaryPostQuail),
              aec: msg.aecDelayMs !== undefined
                ? {
                    delayMs: msg.aecDelayMs,
                    renderActive: msg.aecRenderActive ?? false,
                    doubleTalk: msg.aecDoubleTalk ?? false,
                    adaptiveDelay: msg.aecAdaptiveDelay ?? false,
                  }
                : undefined,
            }
          : undefined,
      });
    });
    const fail = (err: Error) => {
      if (this.worker !== worker || !this.healthy) return;
      this.healthy = false;
      logger.error({ err }, "AudioWorker thread error");
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); }
      this.pending.clear();
      void worker.terminate();
      if (this.restarts++ < 3) setTimeout(() => this.start(), 1000).unref();
    };
    worker.on("error", fail);
    worker.on("exit", code => fail(new Error(`Audio worker exited (${code})`)));
  }

  process(
    type: "PROCESS_MULAW" | "PROCESS_PCM8K",
    callId: string,
    data: Buffer,
    noiseCancel: boolean,
    gateRatio: number,
    vadThreshold: number,
  ): Promise<AudioProcessResult> {
    if (!this.healthy || this.pending.size >= 1000) return Promise.reject(new Error("Audio worker unavailable or overloaded"));
    return new Promise((resolve, reject) => {
      const id = randomBytes(8).toString("hex");
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Audio processing deadline exceeded"));
      }, 2000);
      this.pending.set(id, { resolve, reject, timer });
      const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      try { this.worker.postMessage({ id, type, callId, data: ab, noiseCancel, gateRatio, vadThreshold }, [ab]); }
      catch (err) { clearTimeout(timer); this.pending.delete(id); reject(err); }
    });
  }

  destroySession(callId: string): void {
    if (this.healthy) this.worker.postMessage({ type: "DESTROY_SESSION", callId });
  }

  /** New mediaEpoch — reset AEC3 state without tearing down Quail VF. */
  resetAec(
    callId: string,
    meta?: { mediaEpoch?: number; carrier?: string; route?: string },
  ): void {
    if (this.healthy) {
      this.worker.postMessage({ type: "RESET_AEC", callId, ...meta });
    }
  }

  setCanaryMeta(
    callId: string,
    meta: { mediaEpoch?: number; carrier?: string; route?: string },
  ): void {
    if (this.healthy) {
      this.worker.postMessage({ type: "SET_CANARY_META", callId, ...meta });
    }
  }

  /**
   * Far-end reference for AEC3 — fire-and-forget into the sticky call chain.
   * Must be the same bytes (after μ-law decode) that the carrier plays to the caller.
   */
  feedRender(callId: string, data: Buffer, encoding: "pcm8k" | "mulaw"): void {
    if (!this.healthy) return;
    const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    try {
      this.worker.postMessage({ type: "FEED_RENDER", callId, data: ab, encoding }, [ab]);
    } catch {
      /* overloaded / terminating — skip this far-end frame */
    }
  }
}

/**
 * Sticky worker assignment per callId.
 *
 * A call's AEC3 + ai-coustics state lives on exactly one worker, so once a callId
 * has been routed we must keep sending it to the same worker for the entire
 * duration of the call.  New callIds are assigned to the least-loaded worker
 * at the time of their first chunk to spread load when AEC/NC is heavy.
 *
 * Entries are deleted by destroyAudioSession() at call end to prevent unbounded growth.
 */
const callWorkerIndex = new Map<string, number>();

/** Max in-flight chunks per worker before we log a skew warning. */
const WORKER_SKEW_WARN_THRESHOLD = 5;

let pool: AudioWorkerThread[] = [];
let ready = false;

/** Call once at server startup with the URL of the bundled worker script. */
export function initAudioPool(workerUrl: URL): void {
  if (ready) return;
  ready = true;
  for (let i = 0; i < POOL_SIZE; i++) {
    pool.push(new AudioWorkerThread(workerUrl));
  }
  logger.info(
    { poolSize: POOL_SIZE, cpus: cpus().length, envOverride: process.env["AUDIO_POOL_SIZE"] ?? null },
    "Audio worker pool initialised",
  );
}

/**
 * Return the worker for a callId, using sticky assignment.
 *
 * - If the callId already has an assigned worker (from a previous chunk in this
 *   call), return that worker — Quail VF enhancer state must not move mid-call.
 * - If this is the first chunk for the callId, pick the least-loaded worker
 *   and record the assignment.  Ties are broken by worker index (stable).
 */
function workerFor(callId: string): AudioWorkerThread {
  const existing = callWorkerIndex.get(callId);
  if (existing !== undefined) return pool[existing]!;

  let minLoad = Infinity;
  let minIdx  = 0;
  for (let i = 0; i < pool.length; i++) {
    const load = pool[i]!.pendingCount;
    if (load < minLoad) { minLoad = load; minIdx = i; }
  }

  callWorkerIndex.set(callId, minIdx);

  if (minLoad >= WORKER_SKEW_WARN_THRESHOLD) {
    logger.warn(
      { callId, workerIdx: minIdx, pendingCount: minLoad, poolSize: pool.length },
      "Audio worker pool skew — least-loaded worker already at threshold"
    );
  }

  return pool[minIdx]!;
}

export function processAudioIn(
  callId: string,
  mulawChunk: Buffer,
  noiseCancel: boolean,
  gateRatio: number = GATE_RATIO_DEFAULT,
  vadThreshold: number = VAD_THRESHOLD,
): Promise<AudioProcessResult> {
  // Fallback: if pool is not yet initialised (e.g. in tests), process inline
  if (!ready) return processInline(callId, mulawChunk, noiseCancel, false, gateRatio, vadThreshold);
  return workerFor(callId).process("PROCESS_MULAW", callId, mulawChunk, noiseCancel, gateRatio, vadThreshold);
}

export function processRawPcm8kIn(
  callId: string,
  pcm8k: Buffer,
  noiseCancel: boolean,
  gateRatio: number = GATE_RATIO_DEFAULT,
  vadThreshold: number = VAD_THRESHOLD,
): Promise<AudioProcessResult> {
  if (!ready) return processInline(callId, pcm8k, noiseCancel, true, gateRatio, vadThreshold);
  return workerFor(callId).process("PROCESS_PCM8K", callId, pcm8k, noiseCancel, gateRatio, vadThreshold);
}

/**
 * Tap far-end audio for WebRTC AEC3. Call from the pipeline's onAudioOut wrap
 * with the exact bytes about to hit VoBiz playAudio (or μ-law for other carriers).
 * No-op when AEC3 is disabled or the pool is not ready (inline path buffers separately).
 */
export function feedFarEndRender(
  callId: string,
  data: Buffer,
  encoding: "pcm8k" | "mulaw" = "pcm8k",
): void {
  if (!aec3Enabled()) return;
  if (data.length === 0) return;
  if (!ready) {
    void feedFarEndInline(callId, data, encoding);
    return;
  }
  workerFor(callId).feedRender(callId, data, encoding);
}

/**
 * New VoBiz media WS / mediaEpoch — recreate AEC3 + clear correlation history.
 * Quail VF enhancer is left intact (same call, new socket).
 */
export function resetAecSession(
  callId: string,
  meta?: { mediaEpoch?: number; carrier?: string; route?: string },
): void {
  if (!aec3Enabled()) return;
  const aec = fallbackAec.get(callId);
  if (aec) {
    if (meta) aec.setCanaryRouteMeta(meta);
    aec.reset();
  }
  if (!ready) return;
  const idx = callWorkerIndex.get(callId);
  if (idx === undefined) return;
  pool[idx]!.resetAec(callId, meta);
}

/** Align worker AEC canary logs with pipeline mediaEpoch / carrier / route. */
export function setAudioCanaryMeta(
  callId: string,
  meta: { mediaEpoch?: number; carrier?: string; route?: string },
): void {
  if (!aec3Enabled()) return;
  const aec = fallbackAec.get(callId);
  if (aec) aec.setCanaryRouteMeta(meta);
  if (!ready) return;
  const idx = callWorkerIndex.get(callId);
  if (idx === undefined) return;
  pool[idx]!.setCanaryMeta(callId, meta);
}

export function destroyAudioSession(callId: string): void {
  const enh = fallbackAic.get(callId);
  if (enh) {
    enh.dispose();
    fallbackAic.delete(callId);
  }
  fallbackAicInit.delete(callId);
  const aec = fallbackAec.get(callId);
  if (aec) {
    aec.dispose();
    fallbackAec.delete(callId);
  }
  fallbackAecInit.delete(callId);
  if (!ready) return;
  const worker = workerFor(callId);
  worker.destroySession(callId);
  callWorkerIndex.delete(callId);
}

// ── Inline fallback (no pool) ─────────────────────────────────────────────────

import {
  decodeMulaw,
  upsample8to16,
  hasSpeechEnergy,
  frameRms,
} from "./audio.js";
import {
  aiCousticsConfigured,
  AiCousticsCallEnhancer,
} from "./ai-coustics.js";
import { aec3Enabled, Aec3CallCanceller } from "./aec3.js";
import { voiceCanaryAudioDumpEnabled } from "./voice-canary.js";

const VAD_THRESHOLD = 100;
const GATE_RATIO_DEFAULT = 4.0;
const fallbackAic = new Map<string, AiCousticsCallEnhancer>();
const fallbackAicInit = new Map<string, Promise<boolean>>();
const fallbackAec = new Map<string, Aec3CallCanceller>();
const fallbackAecInit = new Map<string, Promise<boolean>>();

async function getFallbackAec(callId: string): Promise<Aec3CallCanceller | null> {
  if (!aec3Enabled()) return null;
  let aec = fallbackAec.get(callId);
  if (!aec) {
    aec = new Aec3CallCanceller(callId);
    fallbackAec.set(callId, aec);
    fallbackAecInit.set(callId, aec.init());
  }
  const ok = await (fallbackAecInit.get(callId) ?? Promise.resolve(false));
  if (!ok) {
    fallbackAec.delete(callId);
    aec.dispose();
    return null;
  }
  return aec;
}

async function feedFarEndInline(
  callId: string,
  data: Buffer,
  encoding: "pcm8k" | "mulaw",
): Promise<void> {
  const aec = await getFallbackAec(callId);
  if (!aec) return;
  const pcm8k = encoding === "mulaw" ? decodeMulaw(data) : data;
  aec.analyzePcm8k(pcm8k);
}

async function processInline(
  callId: string,
  data: Buffer,
  noiseCancel: boolean,
  alreadyPcm = false,
  _gateRatio: number = GATE_RATIO_DEFAULT,
  vadThreshold: number = VAD_THRESHOLD,
): Promise<AudioProcessResult> {
  let pcm8k = alreadyPcm ? data : decodeMulaw(data);
  const rawRms = frameRms(pcm8k);
  const rawCopy = voiceCanaryAudioDumpEnabled() ? Buffer.from(pcm8k) : null;
  const aec = await getFallbackAec(callId);
  let postAecCopy: Buffer | null = null;
  if (aec) {
    pcm8k = aec.processPcm8k(pcm8k);
    if (rawCopy) postAecCopy = Buffer.from(pcm8k);
  } else if (rawCopy) {
    postAecCopy = Buffer.from(pcm8k);
  }
  if (noiseCancel && aiCousticsConfigured()) {
    let enh = fallbackAic.get(callId);
    if (!enh) {
      enh = new AiCousticsCallEnhancer(callId);
      fallbackAic.set(callId, enh);
      fallbackAicInit.set(callId, enh.init());
    }
    const ok = await (fallbackAicInit.get(callId) ?? Promise.resolve(false));
    if (ok) pcm8k = enh.processPcm8k(pcm8k);
  }
  const pcm16k = upsample8to16(pcm8k);
  const diag = aec?.getDiagnostics();
  return {
    pcm8k,
    pcm16k,
    hasSpeech: pcm8k.length >= 2 && hasSpeechEnergy(pcm8k, vadThreshold),
    rawRms,
    canary: rawCopy && postAecCopy
      ? {
          rawPcm8k: rawCopy,
          postAecPcm8k: postAecCopy,
          postQuailPcm8k: Buffer.from(pcm8k),
          aec: diag
            ? {
                delayMs: diag.delayMs,
                renderActive: diag.renderActive,
                doubleTalk: diag.doubleTalk,
                adaptiveDelay: diag.adaptiveDelay,
              }
            : undefined,
        }
      : undefined,
  };
}

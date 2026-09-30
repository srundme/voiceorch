/**
 * ai-coustics Quail Voice Focus — real-time primary-speaker isolation for
 * inbound telephony audio (before STT / barge-in).
 *
 * Replaces the identity NoiseCanceller when AIC_SDK_LICENSE is set and the
 * agent's Noise Cancellation toggle is on. Quail VF is a 16 kHz model; we
 * upsample 8 kHz PCM, enhance with variable-size blocks, then downsample back.
 *
 * Env:
 *   AIC_SDK_LICENSE   — required (developers.ai-coustics.com SDK key)
 *   AIC_MODEL_ID      — default quail-vf-2.2-l-16khz
 *   AIC_MODEL_DIR     — default <cwd>/models/ai-coustics
 *   AIC_ENHANCEMENT_LEVEL — 0..1 (default 0.8 — ai-coustics Voice AI recommendation)
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { upsample8to16, downsample16to8 } from "./audio.js";

export type AiCousticsStatus =
  | { ok: true; modelId: string; sampleRate: number; blockSize: number }
  | { ok: false; reason: string };

function licenseKey(env: NodeJS.ProcessEnv = process.env): string {
  return (env["AIC_SDK_LICENSE"] ?? "").trim();
}

export function aiCousticsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return licenseKey(env).length > 0;
}

function modelId(env: NodeJS.ProcessEnv = process.env): string {
  return (env["AIC_MODEL_ID"] ?? "quail-vf-2.2-l-16khz").trim() || "quail-vf-2.2-l-16khz";
}

function modelDir(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env["AIC_MODEL_DIR"] ?? "").trim();
  return raw || path.resolve(process.cwd(), "models", "ai-coustics");
}

function enhancementLevel(env: NodeJS.ProcessEnv = process.env): number {
  // ai-coustics Voice AI guidance: 0.8 = best WER balance; 1.0 is aggressive
  // and can suppress quiet foreground speech (bad for soft Tamil / "yes").
  const n = Number(env["AIC_ENHANCEMENT_LEVEL"] ?? 0.8);
  if (!Number.isFinite(n)) return 0.8;
  return Math.min(1, Math.max(0, n));
}

type AicSdk = typeof import("@ai-coustics/aic-sdk");
type AicModel = InstanceType<AicSdk["Model"]>;
type AicProcessor = InstanceType<AicSdk["Processor"]>;

let sdkPromise: Promise<AicSdk | null> | null = null;
let modelPromise: Promise<AicModel | null> | null = null;
let cachedSampleRate = 16000;
let cachedBlockSize = 512;
let loadError: string | null = null;

async function loadSdk(): Promise<AicSdk | null> {
  if (!sdkPromise) {
    sdkPromise = import("@ai-coustics/aic-sdk").catch((err) => {
      loadError = err instanceof Error ? err.message : String(err);
      return null;
    });
  }
  return sdkPromise;
}

/** Download/load Quail VF once per process (shared by all call sessions). */
export async function ensureAiCousticsModel(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AiCousticsStatus> {
  if (!aiCousticsConfigured(env)) {
    return { ok: false, reason: "AIC_SDK_LICENSE unset" };
  }
  if (!modelPromise) {
    modelPromise = (async () => {
      const sdk = await loadSdk();
      if (!sdk) return null;
      const dir = modelDir(env);
      mkdirSync(dir, { recursive: true });
      const id = modelId(env);
      const filePath = await sdk.Model.download(id, dir);
      const model = sdk.Model.fromFile(filePath);
      cachedSampleRate = model.getOptimalSampleRate();
      cachedBlockSize = model.getOptimalBlockSize(cachedSampleRate);
      return model;
    })().catch((err) => {
      loadError = err instanceof Error ? err.message : String(err);
      modelPromise = null;
      return null;
    });
  }
  const model = await modelPromise;
  if (!model) return { ok: false, reason: loadError ?? "model load failed" };
  return {
    ok: true,
    modelId: modelId(env),
    sampleRate: cachedSampleRate,
    blockSize: cachedBlockSize,
  };
}

function pcm16ToFloat32(pcm: Buffer): Float32Array {
  const n = Math.floor(pcm.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = pcm.readInt16LE(i * 2) / 32768;
  return out;
}

function float32ToPcm16(samples: Float32Array): Buffer {
  const out = Buffer.allocUnsafe(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767);
    out.writeInt16LE(s, i * 2);
  }
  return out;
}

/**
 * Per-call enhancer. Sticky to one audio worker (same callId → same worker).
 * Uses variable block size so each 20 ms telephony frame can process immediately.
 */
export class AiCousticsCallEnhancer {
  private processor: AicProcessor | null = null;
  private ready = false;
  private failed = false;

  constructor(
    private readonly callId: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async init(): Promise<boolean> {
    if (this.ready) return true;
    if (this.failed) return false;
    const status = await ensureAiCousticsModel(this.env);
    if (!status.ok) {
      this.failed = true;
      return false;
    }
    const sdk = await loadSdk();
    const model = await modelPromise;
    if (!sdk || !model) {
      this.failed = true;
      return false;
    }
    try {
      const key = licenseKey(this.env);
      this.processor = new sdk.Processor(model, key);
      // variableBlockSize=true: accept ≤ optimal block (20 ms frames are smaller).
      this.processor.initialize(cachedSampleRate, cachedBlockSize, true);
      const ctx = this.processor.getContext();
      const level = enhancementLevel(this.env);
      // SDK types ProcessorParameter as an ambient const enum (unreadable under isolatedModules);
      // the runtime export is a real object.
      type Param = Parameters<typeof ctx.setParameter>[0];
      const params = (sdk as unknown as { ProcessorParameter: Record<"EnhancementLevel" | "Bypass", Param> }).ProcessorParameter;
      ctx.setParameter(params.EnhancementLevel, level);
      ctx.setParameter(params.Bypass, 0);
      this.ready = true;
      return true;
    } catch {
      this.failed = true;
      this.processor = null;
      return false;
    }
  }

  /** Enhance one 8 kHz LINEAR16 chunk in place of the identity NoiseCanceller. */
  processPcm8k(pcm8k: Buffer): Buffer {
    if (!this.ready || !this.processor || pcm8k.length < 2) return pcm8k;

    const pcm16 = upsample8to16(pcm8k);
    const samples = pcm16ToFloat32(pcm16);
    if (samples.length === 0) return pcm8k;
    if (samples.length > cachedBlockSize) {
      const parts: Buffer[] = [];
      for (let i = 0; i < samples.length; i += cachedBlockSize) {
        const slice = samples.subarray(i, Math.min(i + cachedBlockSize, samples.length));
        const block = new Float32Array(slice);
        this.processor.process(block);
        parts.push(float32ToPcm16(block));
      }
      return downsample16to8(Buffer.concat(parts));
    }
    this.processor.process(samples);
    return downsample16to8(float32ToPcm16(samples));
  }

  dispose(): void {
    try {
      this.processor?.dispose();
    } catch { /* best-effort */ }
    this.processor = null;
    this.ready = false;
  }
}

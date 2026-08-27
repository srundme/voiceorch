/**
 * GTCRN neural voice isolation — streaming 16 kHz speech enhancement.
 *
 * Model: Xiaobin-Rong/gtcrn `gtcrn_simple.onnx` (MIT), same weights sherpa-onnx
 * ships for telephony denoise. ~0.5 MB, CPU, hop 16 ms.
 *
 * This is speech enhancement (keep speech, suppress hiss / fans / traffic), not
 * "ignore other people talking". A bystander a few metres away is still speech
 * and must be rejected on RAW mic energy in the pipeline. Run BEFORE VAD / STT.
 * Fail-open: if the ONNX session is missing or VOICE_ISOLATION=0, callers keep
 * the energy gate.
 *
 * Recordings must stay on the RAW 8 kHz path (pipeline already records before
 * processAudioIn).
 */

import type * as OrtNS from "onnxruntime-node";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger.js";
import { createDownsampler16to8, upsample8to16 } from "./audio.js";
import { GTCRN_BINS, GtcrnIstft, GtcrnStft } from "./gtcrn-stft.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = join(__dirname, "orchestration", "gtcrn_simple.onnx");
const SRC_MODEL_PATH = join(__dirname, "gtcrn_simple.onnx");

const CONV_SHAPE = [2, 1, 16, 16, 33] as const;
const TRA_SHAPE = [2, 3, 1, 1, 16] as const;
const INTER_SHAPE = [2, 1, 33, 16] as const;
const MIX_SHAPE = [1, GTCRN_BINS, 1, 2] as const;

function numel(shape: readonly number[]): number {
  return shape.reduce((a, b) => a * b, 1);
}

function resolveModelPath(): string {
  if (existsSync(MODEL_PATH)) return MODEL_PATH;
  if (existsSync(SRC_MODEL_PATH)) return SRC_MODEL_PATH;
  return MODEL_PATH;
}

export function isVoiceIsolationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env["VOICE_ISOLATION"] ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

let _ortPromise: Promise<typeof OrtNS | null> | null = null;
async function loadOrt(): Promise<typeof OrtNS | null> {
  if (!_ortPromise) {
    _ortPromise = import("onnxruntime-node").catch((err) => {
      _ortPromise = null;
      logger.warn({ err }, "VoiceIsolator: onnxruntime-node failed to load");
      return null;
    });
  }
  return _ortPromise;
}

let _sessionPromise: Promise<OrtNS.InferenceSession | null> | null = null;
let _ready = false;

async function getSession(): Promise<OrtNS.InferenceSession | null> {
  if (!isVoiceIsolationEnabled()) return null;
  if (!_sessionPromise) {
    _sessionPromise = (async () => {
      const ort = await loadOrt();
      if (!ort) return null;
      const path = resolveModelPath();
      if (!existsSync(path)) {
        logger.warn({ path }, "VoiceIsolator: GTCRN ONNX missing");
        return null;
      }
      return ort.InferenceSession.create(path, {
        executionProviders: ["cpu"],
        logSeverityLevel: 3,
      });
    })().catch((err) => {
      _sessionPromise = null;
      logger.warn({ err }, "VoiceIsolator: failed to create GTCRN session");
      return null;
    });
  }
  return _sessionPromise;
}

export function isVoiceIsolatorReady(): boolean {
  return _ready;
}

export async function warmVoiceIsolator(): Promise<boolean> {
  if (!isVoiceIsolationEnabled()) {
    logger.info("VoiceIsolator: disabled (VOICE_ISOLATION=0)");
    return false;
  }
  const session = await getSession();
  if (!session) return false;
  _ready = true;
  logger.info({ model: "gtcrn_simple" }, "VoiceIsolator: GTCRN session ready");
  return true;
}

export type IsolatedAudio = {
  pcm8k: Buffer;
  pcm16k: Buffer;
};

/**
 * Per-call streaming isolator. One instance per callId on a sticky audio worker.
 */
export class VoiceIsolator {
  private readonly stft = new GtcrnStft();
  private readonly istft = new GtcrnIstft();
  private readonly down8 = createDownsampler16to8();
  private conv = new Float32Array(numel(CONV_SHAPE));
  private tra = new Float32Array(numel(TRA_SHAPE));
  private inter = new Float32Array(numel(INTER_SHAPE));
  private failed = false;

  constructor(private readonly callId?: string) {}

  async process8k(pcm8k: Buffer): Promise<IsolatedAudio | null> {
    if (this.failed || !isVoiceIsolationEnabled()) return null;
    const session = await getSession();
    const ort = await loadOrt();
    if (!session || !ort) {
      this.failed = true;
      return null;
    }
    _ready = true;

    const pcm16kIn = upsample8to16(pcm8k);
    const n = pcm16kIn.length / 2;
    const f32 = new Float32Array(n);
    for (let i = 0; i < n; i++) f32[i] = pcm16kIn.readInt16LE(i * 2) / 32768;

    const frames = this.stft.push(f32);
    if (frames.length === 0) {
      return { pcm8k: Buffer.alloc(0), pcm16k: Buffer.alloc(0) };
    }

    const hops: Float32Array[] = [];
    try {
      for (const frame of frames) {
        hops.push(await this.inferHop(session, ort, frame.re, frame.im));
      }
    } catch (err) {
      this.failed = true;
      logger.warn({ err, callId: this.callId }, "VoiceIsolator: inference failed — falling back to energy gate");
      return null;
    }

    let total = 0;
    for (const h of hops) total += h.length;
    const out16 = Buffer.allocUnsafe(total * 2);
    let o = 0;
    for (const h of hops) {
      for (let i = 0; i < h.length; i++) {
        const s = Math.round(h[i]! * 32768);
        out16.writeInt16LE(s > 32767 ? 32767 : s < -32768 ? -32768 : s, o);
        o += 2;
      }
    }
    return { pcm16k: out16, pcm8k: this.down8.process(out16) };
  }

  private async inferHop(
    session: OrtNS.InferenceSession,
    ort: typeof OrtNS,
    re: Float32Array,
    im: Float32Array,
  ): Promise<Float32Array> {
    const mix = new Float32Array(GTCRN_BINS * 2);
    for (let f = 0; f < GTCRN_BINS; f++) {
      mix[f * 2] = re[f]!;
      mix[f * 2 + 1] = im[f]!;
    }
    const result = await session.run({
      mix: new ort.Tensor("float32", mix, MIX_SHAPE as unknown as number[]),
      conv_cache: new ort.Tensor("float32", this.conv, CONV_SHAPE as unknown as number[]),
      tra_cache: new ort.Tensor("float32", this.tra, TRA_SHAPE as unknown as number[]),
      inter_cache: new ort.Tensor("float32", this.inter, INTER_SHAPE as unknown as number[]),
    });
    const enh = result["enh"]?.data as Float32Array | undefined;
    if (!enh || enh.length < GTCRN_BINS * 2) {
      throw new Error("GTCRN enh tensor missing");
    }
    if (result["conv_cache_out"]?.data) {
      this.conv = Float32Array.from(result["conv_cache_out"].data as Float32Array);
    }
    if (result["tra_cache_out"]?.data) {
      this.tra = Float32Array.from(result["tra_cache_out"].data as Float32Array);
    }
    if (result["inter_cache_out"]?.data) {
      this.inter = Float32Array.from(result["inter_cache_out"].data as Float32Array);
    }
    const outRe = new Float32Array(GTCRN_BINS);
    const outIm = new Float32Array(GTCRN_BINS);
    for (let f = 0; f < GTCRN_BINS; f++) {
      outRe[f] = enh[f * 2]!;
      outIm[f] = enh[f * 2 + 1]!;
    }
    return this.istft.push(outRe, outIm);
  }
}

export function resetVoiceIsolatorLoaderForTests(): void {
  _sessionPromise = null;
  _ortPromise = null;
  _ready = false;
}

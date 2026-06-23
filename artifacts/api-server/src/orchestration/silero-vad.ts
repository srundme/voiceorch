/**
 * Silero VAD v5 — ONNX-based voice activity detection for webcall streams.
 *
 * Wraps the 2.3 MB silero_vad.onnx model (bundled alongside this file in dist/).
 * The ONNX model is process-global (one InferenceSession shared across calls).
 * Per-call state (LSTM h/c tensors + last result) lives in SileroVAD instances.
 *
 * Usage pattern (fire-and-forget, synchronous read):
 *
 *   const vad = new SileroVAD(callId);
 *   // In the audio frame handler (sync):
 *   vad.push(pcm16Buffer);          // queues async inference, returns immediately
 *   const speaking = vad.isSpeech(); // returns result from most recent completed run
 *   // At call end:
 *   vad.destroy();
 *
 * Audio spec:
 *   - 16 kHz signed Int16 LE PCM (same as AUDIO_CHUNK_BYTES=1280 → 640 samples)
 *   - Internally buffers to 512-sample windows before running inference
 *
 * The model runs on CPU in ~2–5 ms per 32 ms window, well within the 40 ms
 * chunk cadence.  The maximum lag for isSpeech() is one 40 ms chunk (imperceptible).
 *
 * Resilience: onnxruntime-node is imported lazily (dynamic import) so that a missing
 * native dependency (e.g. libgomp.so.1 absent from a slim Docker image) does NOT crash
 * the process at module load time.  If the ONNX session fails to initialise, all
 * SileroVAD instances return isAvailable()=false and callers fall back to energy-based
 * RMS thresholds.
 */

import type * as OrtNS from "onnxruntime-node";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// __dirname in the esbuild bundle = the dist/ directory (set by the banner shim).
// build.mjs copies silero_vad.onnx to dist/orchestration/silero_vad.onnx.
const MODEL_PATH  = join(__dirname, "orchestration", "silero_vad.onnx");
const SAMPLE_RATE = 16000;
const CHUNK_SIZE  = 512;   // samples — optimal window for Silero VAD v5 at 16 kHz (32 ms)

// ── Lazy onnxruntime-node loader ─────────────────────────────────────────────
// Dynamic import so a missing native lib (libgomp, etc.) degrades gracefully
// rather than crashing the process before the HTTP server can bind its port.
let _ortPromise: Promise<typeof OrtNS> | null = null;

async function loadOrt(): Promise<typeof OrtNS | null> {
  if (!_ortPromise) {
    _ortPromise = import("onnxruntime-node").catch((err) => {
      _ortPromise = null;
      logger.warn({ err }, "SileroVAD: onnxruntime-node failed to load — falling back to energy-based VAD");
      return null as unknown as typeof OrtNS;
    });
  }
  return _ortPromise;
}

// ── Process-global InferenceSession (lazy, created on first call) ────────────
let _sessionPromise: Promise<OrtNS.InferenceSession | null> | null = null;

async function getSession(): Promise<OrtNS.InferenceSession | null> {
  if (!_sessionPromise) {
    _sessionPromise = (async () => {
      const ort = await loadOrt();
      if (!ort) return null;
      return ort.InferenceSession.create(MODEL_PATH, {
        executionProviders: ["cpu"],
        logSeverityLevel: 3, // suppress ONNX verbose/info logs
      });
    })().catch((err) => {
      _sessionPromise = null; // allow retry on next call
      logger.warn({ err }, "SileroVAD: failed to create InferenceSession");
      return null;
    });
  }
  return _sessionPromise;
}

/** Warm the ONNX session at server startup so the first call doesn't pay the load cost. */
export async function warmSileroVAD(): Promise<void> {
  const session = await getSession();
  if (session) {
    logger.info("SileroVAD: ONNX session ready");
  }
  // failure already logged inside getSession / loadOrt
}

// ── Per-call instance ─────────────────────────────────────────────────────────

export class SileroVAD {
  private h: Float32Array = new Float32Array(2 * 1 * 64); // LSTM hidden state [2,1,64]
  private c: Float32Array = new Float32Array(2 * 1 * 64); // LSTM cell state   [2,1,64]

  private _isSpeech  = false;
  private _available = false;  // false until first inference succeeds
  private _buf       = new Float32Array(0);  // sub-chunk accumulation buffer
  private _queue: Promise<void> = Promise.resolve(); // sequential inference chain

  constructor(
    private readonly threshold = 0.5,
    private readonly callId?: string | number,
  ) {}

  /**
   * Returns true if the most recently completed inference decided "speech".
   * Returns false (conservatively) before the first inference completes,
   * or if the ONNX session failed to load (caller falls back to energy VAD).
   */
  isSpeech(): boolean {
    return this._isSpeech;
  }

  /** True once the first inference has succeeded. False on ONNX load failure. */
  isAvailable(): boolean {
    return this._available;
  }

  /**
   * Push a 16 kHz Int16-LE PCM buffer.  Internally buffers to 512-sample
   * windows and schedules async ONNX inference (fire-and-forget).
   */
  push(pcm16: Buffer): void {
    const count = pcm16.length >> 1; // 2 bytes / sample
    const f32   = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      f32[i] = pcm16.readInt16LE(i * 2) / 32768.0;
    }

    // Append to accumulation buffer
    const merged = new Float32Array(this._buf.length + count);
    merged.set(this._buf);
    merged.set(f32, this._buf.length);
    this._buf = merged;

    // Drain complete 512-sample windows, queue them sequentially
    while (this._buf.length >= CHUNK_SIZE) {
      const chunk = this._buf.slice(0, CHUNK_SIZE);
      this._buf   = this._buf.slice(CHUNK_SIZE);
      this._queue = this._queue.then(() => this._infer(chunk));
    }
  }

  /** Release LSTM state. Pending inferences may still complete but won't update state. */
  destroy(): void {
    this._buf   = new Float32Array(0);
    this._queue = Promise.resolve();
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private async _infer(samples: Float32Array): Promise<void> {
    const session = await getSession();
    if (!session) return; // ONNX not available — stay on energy-based fallback

    const ort = await loadOrt();
    if (!ort) return;

    try {
      const inputT = new ort.Tensor("float32", samples, [1, CHUNK_SIZE]);
      const srT    = new ort.Tensor("int64",   BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);
      const hT     = new ort.Tensor("float32", this.h, [2, 1, 64]);
      const cT     = new ort.Tensor("float32", this.c, [2, 1, 64]);

      const result = await session.run({ input: inputT, sr: srT, h: hT, c: cT });

      const prob = (result["output"]?.data as Float32Array)?.[0] ?? 0;
      this._isSpeech  = prob >= this.threshold;
      this._available = true;

      // onnxruntime-node returns TypedArrays from .data; copy to detach from session memory
      if (result["hn"]?.data) this.h = Float32Array.from(result["hn"].data as Float32Array);
      if (result["cn"]?.data) this.c = Float32Array.from(result["cn"].data as Float32Array);
    } catch (err) {
      logger.warn({ err, callId: this.callId }, "SileroVAD: inference error");
      this._isSpeech = false;
    }
  }
}

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
 *   - Internally buffers to 512-sample windows, then prepends 64 samples of
 *     Silero v5 context (576-sample model input) before inference
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
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// tsx: this file lives next to silero_vad.onnx.
// esbuild bundle: __dirname is dist/, and build.mjs copies the model to
// dist/orchestration/silero_vad.onnx.
export function resolveSileroModelPath(): string {
  const candidates = [
    join(__dirname, "silero_vad.onnx"),
    join(__dirname, "orchestration", "silero_vad.onnx"),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[1]!;
}

const MODEL_PATH  = resolveSileroModelPath();
export const SILERO_SAMPLE_RATE = 16000;
export const SILERO_CHUNK_SIZE  = 512;   // new samples per window — 32 ms at 16 kHz
/** Silero v5 concatenates 64 samples of prior audio (context) → 576-sample model input. */
export const SILERO_CONTEXT_SIZE = 64;
export const SILERO_MODEL_INPUT_SIZE = SILERO_CHUNK_SIZE + SILERO_CONTEXT_SIZE;
const SAMPLE_RATE = SILERO_SAMPLE_RATE;
const CHUNK_SIZE  = SILERO_CHUNK_SIZE;
const CONTEXT_SIZE = SILERO_CONTEXT_SIZE;

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
  private h: Float32Array = new Float32Array(2 * 1 * 64); // LSTM hidden state [2,1,64] (legacy h/c models)
  private c: Float32Array = new Float32Array(2 * 1 * 64); // LSTM cell state   [2,1,64]
  private state: Float32Array = new Float32Array(2 * 1 * 128); // Silero v5 combined state [2,1,128]
  private context: Float32Array = new Float32Array(CONTEXT_SIZE);

  private _isSpeech  = false;
  private _available = false;  // false until first inference succeeds
  private _lastProb  = 0;
  private _dead      = false;
  private _onInference: ((prob: number, inferMs: number) => void) | null = null;
  private _buf       = new Float32Array(0);  // sub-chunk accumulation buffer
  private _queue: Promise<void> = Promise.resolve(); // sequential inference chain

  constructor(
    private readonly threshold = 0.5,
    private readonly callId?: string | number,
  ) {}

  /** Probability from the most recently completed inference (0 before first run). */
  lastProbability(): number {
    return this._lastProb;
  }

  /** V2 streaming adapter: one callback per completed 32 ms window. */
  setOnInference(cb: ((prob: number, inferMs: number) => void) | null): void {
    this._onInference = cb;
  }

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

  /** Wait until queued 512-sample windows have finished inferring. */
  async flush(): Promise<void> {
    await this._queue;
  }

  /** Release LSTM state. Pending inferences may still complete but won't update state. */
  destroy(): void {
    this._dead = true;
    this._onInference = null;
    this._buf   = new Float32Array(0);
    this.context = new Float32Array(CONTEXT_SIZE);
    this._queue = Promise.resolve();
  }

  /** V5 ONNX wants [context 64][chunk 512] = 576 samples at 16 kHz. */
  private withContext(samples: Float32Array): Float32Array {
    const window = new Float32Array(CONTEXT_SIZE + samples.length);
    window.set(this.context, 0);
    window.set(samples, CONTEXT_SIZE);
    return window;
  }

  private advanceContext(samples: Float32Array): void {
    if (samples.length >= CONTEXT_SIZE) {
      this.context = samples.slice(samples.length - CONTEXT_SIZE);
    } else {
      const next = new Float32Array(CONTEXT_SIZE);
      next.set(this.context.subarray(samples.length));
      next.set(samples, CONTEXT_SIZE - samples.length);
      this.context = next;
    }
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private async _infer(samples: Float32Array): Promise<void> {
    const session = await getSession();
    if (!session) return; // ONNX not available — stay on energy-based fallback

    const ort = await loadOrt();
    if (!ort) return;

    const t0 = performance.now();
    try {
      const useState = session.inputNames.includes("state");
      const window = useState ? this.withContext(samples) : samples;
      const inputT = new ort.Tensor("float32", window, [1, window.length]);
      const srT    = new ort.Tensor("int64",   BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);
      const result = useState
        ? await session.run({
            input: inputT,
            sr: srT,
            state: new ort.Tensor("float32", this.state, [2, 1, 128]),
          })
        : await session.run({
            input: inputT,
            sr: srT,
            h: new ort.Tensor("float32", this.h, [2, 1, 64]),
            c: new ort.Tensor("float32", this.c, [2, 1, 64]),
          });
      const inferMs = performance.now() - t0;

      const prob = (result["output"]?.data as Float32Array)?.[0] ?? 0;
      if (this._dead) return;
      this._lastProb  = prob;
      this._isSpeech  = prob >= this.threshold;
      this._available = true;
      this._onInference?.(prob, inferMs);

      // onnxruntime-node returns TypedArrays from .data; copy to detach from session memory
      if (result["stateN"]?.data) this.state = Float32Array.from(result["stateN"].data as Float32Array);
      if (result["hn"]?.data) this.h = Float32Array.from(result["hn"].data as Float32Array);
      if (result["cn"]?.data) this.c = Float32Array.from(result["cn"].data as Float32Array);
      this.advanceContext(samples);
    } catch (err) {
      logger.warn({ err, callId: this.callId }, "SileroVAD: inference error");
      this._isSpeech = false;
    }
  }
}

/**
 * Pipecat Smart Turn v3.2 — local ONNX end-of-turn classifier.
 *
 * Audio-native: 16 kHz PCM in, probability that the speaker finished their
 * turn. Used AFTER Sarvam VAD silence, never instead of STT.
 *
 * Model: https://huggingface.co/pipecat-ai/smart-turn-v3
 * License: BSD-2-Clause. Hindi is in the 23-language set; Tamil is not —
 * we still run it (prosody) and keep a transcript veto + silence fallback.
 */

import type * as OrtNS from "onnxruntime-node";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger.js";
import {
  computeWhisperLogMelFeatures,
  SMART_TURN_MAX_SAMPLES,
  SMART_TURN_N_FRAMES,
  SMART_TURN_N_MELS,
  SMART_TURN_SAMPLE_RATE,
} from "./smart-turn-mel.js";
import type { EouVerdict } from "./semantic-turn-gate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = join(__dirname, "orchestration", "smart-turn-v3.2-cpu.onnx");
const THRESHOLD = 0.5;

let _ortPromise: Promise<typeof OrtNS> | null = null;

async function loadOrt(): Promise<typeof OrtNS | null> {
  if (!_ortPromise) {
    _ortPromise = import("onnxruntime-node").catch((err) => {
      _ortPromise = null;
      logger.warn({ err }, "SmartTurn: onnxruntime-node failed to load");
      return null as unknown as typeof OrtNS;
    });
  }
  return _ortPromise;
}

let _sessionPromise: Promise<OrtNS.InferenceSession | null> | null = null;
/** True after the first successful session create + warmup inference. */
let _ready = false;

export function isSmartTurnReady(): boolean {
  return _ready;
}

async function getSession(): Promise<OrtNS.InferenceSession | null> {
  if (!_sessionPromise) {
    _sessionPromise = (async () => {
      const ort = await loadOrt();
      if (!ort) return null;
      return ort.InferenceSession.create(MODEL_PATH, {
        executionProviders: ["cpu"],
        logSeverityLevel: 3,
      });
    })().catch((err) => {
      _sessionPromise = null;
      logger.warn({ err, modelPath: MODEL_PATH }, "SmartTurn: failed to load ONNX session");
      return null;
    });
  }
  return _sessionPromise;
}

export async function warmSmartTurn(): Promise<void> {
  if (_ready) return;
  const session = await getSession();
  if (!session) return;
  const silent = Buffer.alloc(SMART_TURN_SAMPLE_RATE * 2);
  await runInference(silent);
  _ready = true;
  logger.info("SmartTurn: ONNX session ready");
}

async function runInference(pcm16k: Buffer): Promise<{
  verdict: EouVerdict;
  probability: number;
} | null> {
  const session = await getSession();
  if (!session) return null;
  const ort = await loadOrt();
  if (!ort) return null;
  if (pcm16k.length < 320) {
    return { verdict: "incomplete", probability: 0 };
  }
  try {
    const audio = pcm16kToFloat32Last8s(pcm16k);
    const logMel = computeWhisperLogMelFeatures(audio, true);
    const input = new ort.Tensor("float32", logMel, [1, SMART_TURN_N_MELS, SMART_TURN_N_FRAMES]);
    const result = await session.run({ input_features: input });
    const first = Object.values(result)[0];
    const probability = Number((first?.data as Float32Array | undefined)?.[0] ?? NaN);
    if (!Number.isFinite(probability)) return null;
    return {
      verdict: probability > THRESHOLD ? "complete" : "incomplete",
      probability,
    };
  } catch (err) {
    logger.warn({ err }, "SmartTurn: inference error");
    return null;
  }
}

function pcm16kToFloat32Last8s(pcm16k: Buffer): Float32Array {
  const samples = pcm16k.length >> 1;
  const max = SMART_TURN_MAX_SAMPLES;
  const startSample = samples > max ? samples - max : 0;
  const count = Math.min(samples, max);
  const out = new Float32Array(max);
  const offset = max - count; // left-pad zeros, audio at the end
  for (let i = 0; i < count; i++) {
    out[offset + i] = pcm16k.readInt16LE((startSample + i) * 2) / 32768;
  }
  return out;
}

export async function predictSmartTurn(pcm16k: Buffer): Promise<{
  verdict: EouVerdict;
  probability: number;
} | null> {
  // First turns after process boot must not sit in InferenceSession.create
  // until the 400 ms eval race fires — that used to fail-open, and now HOLDs.
  if (!_ready) {
    void warmSmartTurn();
    return null;
  }
  return runInference(pcm16k);
}

/**
 * Audio processing worker — runs in a dedicated worker thread.
 *
 * Each worker maintains per-session NoiseCanceller state so callers never have
 * to serialize that state across the thread boundary.  The pool in audioPool.ts
 * uses consistent hashing (callId % poolSize) so every chunk for the same call
 * always lands on the same worker, guaranteeing FIFO ordering and correct state.
 *
 * Message protocol (main → worker):
 *   { id, type:"PROCESS_MULAW", callId, data:ArrayBuffer, noiseCancel }
 *   { id, type:"PROCESS_PCM8K", callId, data:ArrayBuffer, noiseCancel }
 *   {     type:"DESTROY_SESSION", callId }
 *
 * Message protocol (worker → main):
 *   { id, pcm8k:ArrayBuffer, pcm16k:ArrayBuffer, hasSpeech }
 */

import { parentPort } from "worker_threads";
import {
  decodeMulaw,
  upsample8to16,
  hasSpeechEnergy,
  NoiseCanceller,
} from "./audio.js";

const VAD_THRESHOLD = 100;
const GATE_RATIO_DEFAULT = 4.0;

interface ProcessMulaw {
  id: string;
  type: "PROCESS_MULAW";
  callId: string;
  data: ArrayBuffer;
  noiseCancel: boolean;
  /** Per-agent Mic Sensitivity thresholds (see mic-sensitivity.ts). Optional for backward compat. */
  gateRatio?: number;
  vadThreshold?: number;
}

interface ProcessPcm8k {
  id: string;
  type: "PROCESS_PCM8K";
  callId: string;
  data: ArrayBuffer;
  noiseCancel: boolean;
  gateRatio?: number;
  vadThreshold?: number;
}

interface DestroySession {
  type: "DESTROY_SESSION";
  callId: string;
}

type InMsg = ProcessMulaw | ProcessPcm8k | DestroySession;

// Per-session NoiseCanceller instances (keyed by callId string)
const noiseCancellers = new Map<string, NoiseCanceller>();

function getNoiseCanceller(callId: string, gateRatio: number): NoiseCanceller {
  let nc = noiseCancellers.get(callId);
  if (!nc) {
    // gateRatio is fixed at creation (per-call state) — set on the FIRST chunk
    // of the call, which always carries the agent's resolved sensitivity.
    nc = new NoiseCanceller(gateRatio);
    noiseCancellers.set(callId, nc);
  }
  return nc;
}

function toTransferable(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

parentPort!.on("message", (msg: InMsg) => {
  if (msg.type === "DESTROY_SESSION") {
    noiseCancellers.delete(msg.callId);
    return;
  }

  const { id, callId, noiseCancel, gateRatio, vadThreshold } = msg;

  let pcm8k =
    msg.type === "PROCESS_MULAW"
      ? decodeMulaw(Buffer.from(msg.data))
      : Buffer.from(msg.data);

  if (noiseCancel) {
    pcm8k = getNoiseCanceller(callId, gateRatio ?? GATE_RATIO_DEFAULT).process(pcm8k);
  }

  const pcm16k = upsample8to16(pcm8k);
  const hasSpeech = hasSpeechEnergy(pcm8k, vadThreshold ?? VAD_THRESHOLD);

  const pcm8kAb  = toTransferable(pcm8k);
  const pcm16kAb = toTransferable(pcm16k);

  parentPort!.postMessage(
    { id, pcm8k: pcm8kAb, pcm16kAb: pcm16kAb, hasSpeech },
    [pcm8kAb, pcm16kAb]
  );
});

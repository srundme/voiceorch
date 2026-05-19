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

interface ProcessMulaw {
  id: string;
  type: "PROCESS_MULAW";
  callId: string;
  data: ArrayBuffer;
  noiseCancel: boolean;
}

interface ProcessPcm8k {
  id: string;
  type: "PROCESS_PCM8K";
  callId: string;
  data: ArrayBuffer;
  noiseCancel: boolean;
}

interface DestroySession {
  type: "DESTROY_SESSION";
  callId: string;
}

type InMsg = ProcessMulaw | ProcessPcm8k | DestroySession;

// Per-session NoiseCanceller instances (keyed by callId string)
const noiseCancellers = new Map<string, NoiseCanceller>();

function getNoiseCanceller(callId: string): NoiseCanceller {
  let nc = noiseCancellers.get(callId);
  if (!nc) {
    nc = new NoiseCanceller();
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

  const { id, callId, noiseCancel } = msg;

  let pcm8k =
    msg.type === "PROCESS_MULAW"
      ? decodeMulaw(Buffer.from(msg.data))
      : Buffer.from(msg.data);

  if (noiseCancel) {
    pcm8k = getNoiseCanceller(callId).process(pcm8k);
  }

  const pcm16k = upsample8to16(pcm8k);
  const hasSpeech = hasSpeechEnergy(pcm8k, VAD_THRESHOLD);

  const pcm8kAb  = toTransferable(pcm8k);
  const pcm16kAb = toTransferable(pcm16k);

  parentPort!.postMessage(
    { id, pcm8k: pcm8kAb, pcm16kAb: pcm16kAb, hasSpeech },
    [pcm8kAb, pcm16kAb]
  );
});

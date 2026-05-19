/**
 * Audio worker pool — manages a fixed set of worker threads for CPU-intensive
 * audio processing (mulaw decode, noise cancellation, upsampling, VAD).
 *
 * Pool size: max(2, cpuCount - 1).
 *
 * Routing: consistent hash on callId so every chunk for the same call goes to
 * the same worker. This guarantees:
 *   1. NoiseCanceller state is always in the right worker.
 *   2. Chunks resolve in the order they were posted (FIFO per worker).
 */

import { Worker } from "worker_threads";
import { cpus } from "os";
import { randomBytes } from "crypto";
import { logger } from "../lib/logger.js";

const POOL_SIZE = Math.max(2, cpus().length - 1);

export interface AudioProcessResult {
  pcm8k: Buffer;
  pcm16k: Buffer;
  hasSpeech: boolean;
}

interface WorkerResponse {
  id: string;
  pcm8k: ArrayBuffer;
  pcm16kAb: ArrayBuffer;
  hasSpeech: boolean;
}

interface Pending {
  resolve: (r: AudioProcessResult) => void;
  reject:  (e: Error) => void;
}

class AudioWorkerThread {
  private worker: Worker;
  private pending = new Map<string, Pending>();

  constructor(workerUrl: URL) {
    this.worker = new Worker(workerUrl);
    this.worker.on("message", (msg: WorkerResponse) => {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      p.resolve({
        pcm8k:    Buffer.from(msg.pcm8k),
        pcm16k:   Buffer.from(msg.pcm16kAb),
        hasSpeech: msg.hasSpeech,
      });
    });
    this.worker.on("error", (err) => {
      logger.error({ err }, "AudioWorker thread error");
      for (const p of this.pending.values()) p.reject(err as Error);
      this.pending.clear();
    });
  }

  process(
    type: "PROCESS_MULAW" | "PROCESS_PCM8K",
    callId: string,
    data: Buffer,
    noiseCancel: boolean
  ): Promise<AudioProcessResult> {
    return new Promise((resolve, reject) => {
      const id = randomBytes(8).toString("hex");
      this.pending.set(id, { resolve, reject });
      const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      this.worker.postMessage({ id, type, callId, data: ab, noiseCancel }, [ab]);
    });
  }

  destroySession(callId: string): void {
    this.worker.postMessage({ type: "DESTROY_SESSION", callId });
  }
}

let pool: AudioWorkerThread[] = [];
let ready = false;

/** Call once at server startup with the URL of the bundled worker script. */
export function initAudioPool(workerUrl: URL): void {
  if (ready) return;
  ready = true;
  for (let i = 0; i < POOL_SIZE; i++) {
    pool.push(new AudioWorkerThread(workerUrl));
  }
  logger.info({ poolSize: POOL_SIZE }, "Audio worker pool initialised");
}

/** Consistent hash: same callId always routes to the same worker. */
function workerFor(callId: string): AudioWorkerThread {
  let h = 0;
  for (let i = 0; i < callId.length; i++) h = (h * 31 + callId.charCodeAt(i)) | 0;
  return pool[Math.abs(h) % pool.length]!;
}

export function processAudioIn(
  callId: string,
  mulawChunk: Buffer,
  noiseCancel: boolean
): Promise<AudioProcessResult> {
  // Fallback: if pool is not yet initialised (e.g. in tests), process inline
  if (!ready) return processInline(mulawChunk, noiseCancel);
  return workerFor(callId).process("PROCESS_MULAW", callId, mulawChunk, noiseCancel);
}

export function processRawPcm8kIn(
  callId: string,
  pcm8k: Buffer,
  noiseCancel: boolean
): Promise<AudioProcessResult> {
  if (!ready) return processInline(pcm8k, noiseCancel, true);
  return workerFor(callId).process("PROCESS_PCM8K", callId, pcm8k, noiseCancel);
}

export function destroyAudioSession(callId: string): void {
  if (!ready) return;
  workerFor(callId).destroySession(callId);
}

// ── Inline fallback (no pool) ─────────────────────────────────────────────────

import {
  decodeMulaw,
  upsample8to16,
  hasSpeechEnergy,
  NoiseCanceller,
} from "./audio.js";

const VAD_THRESHOLD = 100;
const fallbackNc = new Map<string, NoiseCanceller>();

async function processInline(
  data: Buffer,
  noiseCancel: boolean,
  alreadyPcm = false
): Promise<AudioProcessResult> {
  let pcm8k = alreadyPcm ? data : decodeMulaw(data);
  if (noiseCancel) {
    let nc = fallbackNc.get("default");
    if (!nc) { nc = new NoiseCanceller(); fallbackNc.set("default", nc); }
    pcm8k = nc.process(pcm8k);
  }
  return {
    pcm8k,
    pcm16k: upsample8to16(pcm8k),
    hasSpeech: hasSpeechEnergy(pcm8k, VAD_THRESHOLD),
  };
}

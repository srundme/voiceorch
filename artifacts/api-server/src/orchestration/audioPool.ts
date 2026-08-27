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

/**
 * Cap the worker pool. Railway (and other hosts) often report a large shared
 * CPU count; spawning cpus()-1 workers each loading GTCRN ONNX at boot OOMs the
 * container right after "Server listening", so /api/healthz never stays up.
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
  /** Pre-isolation frame RMS. Used to reject far-field bystanders; GTCRN keeps their speech. */
  rawRms: number;
}

interface WorkerResponse {
  id: string;
  pcm8k?: ArrayBuffer;
  pcm16kAb?: ArrayBuffer;
  hasSpeech?: boolean;
  rawRms?: number;
  error?: string;
}

interface Pending {
  resolve: (r: AudioProcessResult) => void;
  reject:  (e: Error) => void;
}

class AudioWorkerThread {
  private worker: Worker;
  private pending = new Map<string, Pending>();

  /** Number of in-flight requests on this worker — used for load-based routing. */
  get pendingCount(): number { return this.pending.size; }

  constructor(workerUrl: URL) {
    this.worker = new Worker(workerUrl);
    this.worker.on("message", (msg: WorkerResponse) => {
      const p = this.pending.get(msg.id);
      if (!p) return;
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
    noiseCancel: boolean,
    gateRatio: number,
    vadThreshold: number,
  ): Promise<AudioProcessResult> {
    return new Promise((resolve, reject) => {
      const id = randomBytes(8).toString("hex");
      this.pending.set(id, { resolve, reject });
      const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      this.worker.postMessage({ id, type, callId, data: ab, noiseCancel, gateRatio, vadThreshold }, [ab]);
    });
  }

  destroySession(callId: string): void {
    this.worker.postMessage({ type: "DESTROY_SESSION", callId });
  }
}

/**
 * Sticky worker assignment per callId.
 *
 * A call's NoiseCanceller state lives on exactly one worker, so once a callId
 * has been routed we must keep sending it to the same worker for the entire
 * duration of the call.  New callIds are assigned to the least-loaded worker
 * at the time of their first chunk to spread load when noise cancellation is
 * heavy on some workers.
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
 *   call), return that worker — NoiseCanceller state must not move mid-call.
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

export function destroyAudioSession(callId: string): void {
  fallbackNc.delete(callId);
  fallbackIso.delete(callId);
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
  NoiseCanceller,
} from "./audio.js";
import { VoiceIsolator, isVoiceIsolationEnabled } from "./voice-isolator.js";

const VAD_THRESHOLD = 100;
const GATE_RATIO_DEFAULT = 4.0;
const fallbackNc = new Map<string, NoiseCanceller>();
const fallbackIso = new Map<string, VoiceIsolator>();

async function processInline(
  callId: string,
  data: Buffer,
  noiseCancel: boolean,
  alreadyPcm = false,
  gateRatio: number = GATE_RATIO_DEFAULT,
  vadThreshold: number = VAD_THRESHOLD,
): Promise<AudioProcessResult> {
  let pcm8k = alreadyPcm ? data : decodeMulaw(data);
  const rawRms = frameRms(pcm8k);
  let pcm16k: Buffer | null = null;
  if (noiseCancel) {
    if (isVoiceIsolationEnabled()) {
      let iso = fallbackIso.get(callId);
      if (!iso) {
        iso = new VoiceIsolator(callId);
        fallbackIso.set(callId, iso);
      }
      const isolated = await iso.process8k(pcm8k);
      if (isolated) {
        pcm8k = isolated.pcm8k;
        pcm16k = isolated.pcm16k;
      } else {
        let nc = fallbackNc.get(callId);
        if (!nc) {
          nc = new NoiseCanceller(gateRatio);
          fallbackNc.set(callId, nc);
        }
        pcm8k = nc.process(pcm8k);
      }
    } else {
      let nc = fallbackNc.get(callId);
      if (!nc) {
        nc = new NoiseCanceller(gateRatio);
        fallbackNc.set(callId, nc);
      }
      pcm8k = nc.process(pcm8k);
    }
  }
  if (!pcm16k) pcm16k = upsample8to16(pcm8k);
  return {
    pcm8k,
    pcm16k,
    hasSpeech: pcm8k.length >= 2 && hasSpeechEnergy(pcm8k, vadThreshold),
    rawRms,
  };
}

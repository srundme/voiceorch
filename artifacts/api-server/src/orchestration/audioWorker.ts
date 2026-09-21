/**
 * Audio processing worker — runs in a dedicated worker thread.
 *
 * Order for inbound PCM (VoBiz / PSTN):
 *   1. WebRTC AEC3 (far-end = FEED_RENDER from onAudioOut)
 *   2. ai-coustics Quail Voice Focus when noiseCancel is on
 *
 * Sticky callId → worker so AEC3 + Quail state stay on one thread.
 *
 * Message protocol (main → worker):
 *   { type:"FEED_RENDER", callId, data:ArrayBuffer, encoding:"pcm8k"|"mulaw" }
 *   { id, type:"PROCESS_MULAW", callId, data:ArrayBuffer, noiseCancel }
 *   { id, type:"PROCESS_PCM8K", callId, data:ArrayBuffer, noiseCancel }
 *   {     type:"RESET_AEC", callId, mediaEpoch?, carrier?, route? }
 *   {     type:"SET_CANARY_META", callId, mediaEpoch?, carrier?, route? }
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
  frameRms,
} from "./audio.js";
import {
  aiCousticsConfigured,
  AiCousticsCallEnhancer,
} from "./ai-coustics.js";
import { aec3Enabled, Aec3CallCanceller } from "./aec3.js";
import { voiceCanaryAudioDumpEnabled } from "./voice-canary.js";

const VAD_THRESHOLD = 100;

interface FeedRender {
  type: "FEED_RENDER";
  callId: string;
  data: ArrayBuffer;
  encoding: "pcm8k" | "mulaw";
}

interface ProcessMulaw {
  id: string;
  type: "PROCESS_MULAW";
  callId: string;
  data: ArrayBuffer;
  noiseCancel: boolean;
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

interface ResetAec {
  type: "RESET_AEC";
  callId: string;
  mediaEpoch?: number;
  carrier?: string;
  route?: string;
}

interface SetCanaryMeta {
  type: "SET_CANARY_META";
  callId: string;
  mediaEpoch?: number;
  carrier?: string;
  route?: string;
}

type InMsg = FeedRender | ProcessMulaw | ProcessPcm8k | DestroySession | ResetAec | SetCanaryMeta;

const aicEnhancers = new Map<string, AiCousticsCallEnhancer>();
const aicInit = new Map<string, Promise<boolean>>();
const aecCancellers = new Map<string, Aec3CallCanceller>();
const aecInit = new Map<string, Promise<boolean>>();
const callChains = new Map<string, Promise<void>>();
const aicMissingLogged = new Set<string>();

async function getAiEnhancer(callId: string): Promise<AiCousticsCallEnhancer | null> {
  if (!aiCousticsConfigured()) return null;
  let enh = aicEnhancers.get(callId);
  if (!enh) {
    enh = new AiCousticsCallEnhancer(callId);
    aicEnhancers.set(callId, enh);
  }
  let pending = aicInit.get(callId);
  if (!pending) {
    pending = enh.init().then((ok) => {
      if (!ok) {
        aicEnhancers.delete(callId);
        enh.dispose();
      }
      return ok;
    });
    aicInit.set(callId, pending);
  }
  const ok = await pending;
  return ok ? (aicEnhancers.get(callId) ?? null) : null;
}

async function getAec(callId: string): Promise<Aec3CallCanceller | null> {
  if (!aec3Enabled()) return null;
  let aec = aecCancellers.get(callId);
  if (!aec) {
    aec = new Aec3CallCanceller(callId);
    aecCancellers.set(callId, aec);
  }
  let pending = aecInit.get(callId);
  if (!pending) {
    pending = aec.init().then((ok) => {
      if (!ok) {
        aecCancellers.delete(callId);
        aec.dispose();
      }
      return ok;
    });
    aecInit.set(callId, pending);
  }
  const ok = await pending;
  return ok ? (aecCancellers.get(callId) ?? null) : null;
}

function toTransferable(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function feedRender(msg: FeedRender): Promise<void> {
  const aec = await getAec(msg.callId);
  if (!aec) return;
  const pcm8k =
    msg.encoding === "mulaw"
      ? decodeMulaw(Buffer.from(msg.data))
      : Buffer.from(msg.data);
  aec.analyzePcm8k(pcm8k);
}

async function processChunk(msg: ProcessMulaw | ProcessPcm8k): Promise<void> {
  const { id, callId, noiseCancel, vadThreshold } = msg;
  const dump = voiceCanaryAudioDumpEnabled();

  let pcm8k =
    msg.type === "PROCESS_MULAW"
      ? decodeMulaw(Buffer.from(msg.data))
      : Buffer.from(msg.data);
  const rawRms = frameRms(pcm8k);
  const rawCopy = dump ? Buffer.from(pcm8k) : null;

  const aec = await getAec(callId);
  if (aec) pcm8k = aec.processPcm8k(pcm8k);
  const postAecCopy = dump ? Buffer.from(pcm8k) : null;
  const diag = aec?.getDiagnostics();

  if (noiseCancel) {
    const aic = await getAiEnhancer(callId);
    if (aic) {
      pcm8k = aic.processPcm8k(pcm8k);
    } else if (!aicMissingLogged.has(callId)) {
      aicMissingLogged.add(callId);
      // NC toggle on but no AIC_SDK_LICENSE / model failed — pass audio through.
    }
  }

  const pcm16k = upsample8to16(pcm8k);
  const hasSpeech = pcm8k.length >= 2 && hasSpeechEnergy(pcm8k, vadThreshold ?? VAD_THRESHOLD);

  const pcm8kAb = toTransferable(pcm8k);
  const pcm16kAb = toTransferable(pcm16k);
  const transfer: ArrayBuffer[] = [pcm8kAb, pcm16kAb];
  const payload: Record<string, unknown> = {
    id,
    pcm8k: pcm8kAb,
    pcm16kAb,
    hasSpeech,
    rawRms,
  };
  if (diag) {
    payload.hasAecDiag = true;
    payload.aecDelayMs = diag.delayMs;
    payload.aecRenderActive = diag.renderActive;
    payload.aecDoubleTalk = diag.doubleTalk;
    payload.aecAdaptiveDelay = diag.adaptiveDelay;
  }
  if (rawCopy && postAecCopy) {
    const canaryRaw = toTransferable(rawCopy);
    const canaryPostAec = toTransferable(postAecCopy);
    const canaryPostQuail = toTransferable(Buffer.from(pcm8k));
    transfer.push(canaryRaw, canaryPostAec, canaryPostQuail);
    payload.canaryRaw = canaryRaw;
    payload.canaryPostAec = canaryPostAec;
    payload.canaryPostQuail = canaryPostQuail;
  }

  parentPort!.postMessage(payload, transfer);
}

function destroyCall(callId: string): void {
  const aic = aicEnhancers.get(callId);
  if (aic) {
    aic.dispose();
    aicEnhancers.delete(callId);
  }
  aicInit.delete(callId);
  aicMissingLogged.delete(callId);
  const aec = aecCancellers.get(callId);
  if (aec) {
    aec.dispose();
    aecCancellers.delete(callId);
  }
  aecInit.delete(callId);
  callChains.delete(callId);
}

function applyCanaryMeta(
  callId: string,
  meta: { mediaEpoch?: number; carrier?: string; route?: string },
): void {
  const aec = aecCancellers.get(callId);
  if (aec) aec.setCanaryRouteMeta(meta);
}

parentPort!.on("message", (msg: InMsg) => {
  if (msg.type === "DESTROY_SESSION") {
    destroyCall(msg.callId);
    return;
  }
  if (msg.type === "SET_CANARY_META") {
    const prev = callChains.get(msg.callId) ?? Promise.resolve();
    const next = prev.then(async () => {
      // Ensure AEC exists so meta sticks before first FEED_RENDER / PROCESS.
      await getAec(msg.callId);
      applyCanaryMeta(msg.callId, msg);
    }).catch(() => { /* ignore */ });
    callChains.set(msg.callId, next);
    return;
  }
  if (msg.type === "RESET_AEC") {
    const prev = callChains.get(msg.callId) ?? Promise.resolve();
    const next = prev.then(() => {
      applyCanaryMeta(msg.callId, msg);
      aecCancellers.get(msg.callId)?.reset();
    }).catch(() => {
      /* reset must not break the call chain */
    });
    callChains.set(msg.callId, next);
    return;
  }

  const prev = callChains.get(msg.callId) ?? Promise.resolve();
  const next =
    msg.type === "FEED_RENDER"
      ? prev.then(() => feedRender(msg)).catch(() => {
          /* far-end feed must never break the call chain */
        })
      : prev
          .then(() => processChunk(msg))
          .catch((err) => {
            parentPort!.postMessage({
              id: msg.id,
              error: err instanceof Error ? err.message : String(err),
            });
          });
  callChains.set(msg.callId, next);
});

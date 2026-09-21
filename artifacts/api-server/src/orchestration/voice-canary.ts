/**
 * VoBiz voice-canary telemetry helpers.
 *
 * VOICE_CANARY — structured per-call logs (default on). Events, not per-frame.
 * VOICE_CANARY_AUDIO — PCM stage dumps on failure only. Keep OFF outside canary.
 *   Dumps may contain personal / sensitive speech. Short retention only.
 * VOICE_CANARY_AUDIO_TTL_MS — max age of held stage PCM (default 60_000).
 *
 * Rollback adaptive AEC delay:
 *   AEC3_ADAPTIVE_DELAY=0
 *   AEC3_STREAM_DELAY_MS=<known-safe seed>
 */

export type BargeSourceKind = "stt" | "context" | "energy" | "vad" | "other";

export type VoiceCanaryRouteMeta = {
  callId: string | number;
  mediaEpoch: number;
  /** Telephony carrier, e.g. vobiz | plivo | twilio | webcall. */
  carrier: string;
  /** Call/session route id for correlating media sockets. */
  route: string;
};

/** Fields present on every canary log line for cross-event reconstruction. */
export type VoiceCanaryBaseFields = VoiceCanaryRouteMeta & {
  voiceCanary: true;
  /** Wall clock (ms since epoch) — human / log-shipper friendly. */
  wallTsMs: number;
  /** Monotonic ns since process start — ordering across AEC/STT/endpoint/barge. */
  monoTsNs: string;
};

function envFlagOn(raw: string | undefined, defaultOn: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return defaultOn;
  const v = raw.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  return defaultOn;
}

export function voiceCanaryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envFlagOn(env["VOICE_CANARY"], true);
}

/**
 * PCM dumps: opt-in only, canary calls. Never default on.
 * Prefer enabling only for the 5–50 call canary window, then disable.
 */
export function voiceCanaryAudioDumpEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!voiceCanaryEnabled(env)) return false;
  return envFlagOn(env["VOICE_CANARY_AUDIO"], false);
}

/** How long stage PCM may linger in memory after last update (ms). */
export function voiceCanaryAudioTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env["VOICE_CANARY_AUDIO_TTL_MS"] ?? 60_000);
  if (!Number.isFinite(n) || n < 1_000) return 60_000;
  return Math.min(300_000, Math.floor(n)); // hard cap 5 min
}

/** Map pipeline barge triggers → canary taxonomy. */
export function classifyBargeSource(trigger: string): BargeSourceKind {
  switch (trigger) {
    case "stt_partial":
    case "queued_final":
    case "word_count":
      return "stt";
    case "vad_speech_start":
      return "vad";
    case "energy":
    case "near_talker_energy":
      return "energy";
    case "short_answer":
    case "contextual_short_answer":
      return "context";
    default:
      return "other";
  }
}

/** Last ~200 ms of 8 kHz s16le as base64 for failed-call inspection. */
export function pcmSnippetB64(pcm8k: Buffer, maxMs = 200): string {
  const maxBytes = Math.floor(maxMs * 16); // 8 kHz * 2 bytes
  const slice = pcm8k.length > maxBytes ? pcm8k.subarray(pcm8k.length - maxBytes) : pcm8k;
  return slice.toString("base64");
}

/** Shared reconstructable fields for every canary event. */
export function voiceCanaryBaseFields(meta: VoiceCanaryRouteMeta): VoiceCanaryBaseFields {
  return {
    voiceCanary: true,
    callId: meta.callId,
    mediaEpoch: meta.mediaEpoch,
    carrier: meta.carrier,
    route: meta.route,
    wallTsMs: Date.now(),
    monoTsNs: process.hrtime.bigint().toString(),
  };
}

/** Stage PCM with capture time — drop when past TTL (sensitive speech). */
export type CanaryAudioStages = {
  capturedAtMs: number;
  rawPcm8k: Buffer;
  postAecPcm8k: Buffer;
  postQuailPcm8k: Buffer;
  aec?: {
    delayMs: number;
    renderActive: boolean;
    doubleTalk: boolean;
    adaptiveDelay: boolean;
  };
};

export function canaryStagesStillFresh(
  stages: CanaryAudioStages | null | undefined,
  nowMs: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): stages is CanaryAudioStages {
  if (!stages) return false;
  return nowMs - stages.capturedAtMs <= voiceCanaryAudioTtlMs(env);
}

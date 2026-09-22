/**
 * Soft TTS duck during suspected double-talk.
 *
 * Prefer −12 dB for ~150 ms before a hard barge cancel. Clicks / shop noise
 * often die in that window; genuine caller speech persists → full cancel.
 */

import { decodeMulaw, encodeMulaw } from "./audio.js";

/** Target attenuation while soft-ducking (plan: −10…−15 dB). */
export const TTS_DUCK_DB = -12;
/** How long to duck before promoting to hard barge. */
export const TTS_DUCK_MS = 150;
/** Linear amplitude for TTS_DUCK_DB. */
export const TTS_DUCK_LINEAR = Math.pow(10, TTS_DUCK_DB / 20);

export type SoftDuckDecision = "hard_barge" | "soft_duck";

/**
 * Clear interrupts skip the duck window. Weak / fragment evidence ducks first.
 */
export function preferSoftDuckBeforeBarge(opts: {
  trigger: string;
  text?: string;
  hardInterrupt?: boolean;
  shortAnswerAccepted?: boolean;
}): SoftDuckDecision {
  if (opts.hardInterrupt) return "hard_barge";
  if (opts.shortAnswerAccepted) return "hard_barge";
  // STT partials always soft-duck first. BG/TV often hallucinates multi-word
  // text that used to hard-barge immediately (call 28055). Promote only if
  // Silero/AEC still shows speech after TTS_DUCK_MS.
  if (opts.trigger === "stt_partial" || opts.trigger === "vad_speech_start") {
    return "soft_duck";
  }
  const text = (opts.text ?? "").trim();
  const words = text.split(/\s+/).filter(Boolean);
  // Usable multi-word finals / word_count — treat as real barge immediately.
  if (
    (opts.trigger === "word_count" || opts.trigger === "queued_final")
    && (words.length >= 2 || text.length >= 12)
  ) {
    return "hard_barge";
  }
  // Single-word / energy — duck first.
  return "soft_duck";
}

/** Scale signed 16-bit LE PCM in place (or copy). */
export function applyLinearGainPcm16(pcm: Buffer, gain: number = TTS_DUCK_LINEAR): Buffer {
  if (pcm.length < 2 || gain >= 0.999) return pcm;
  const out = Buffer.allocUnsafe(pcm.length);
  const n = pcm.length >>> 1;
  for (let i = 0; i < n; i++) {
    const s = Math.round(pcm.readInt16LE(i * 2) * gain);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, s)), i * 2);
  }
  return out;
}

/** Decode μ-law → scale → re-encode (VoBiz wire). */
export function applyLinearGainMulaw(mulaw: Buffer, gain: number = TTS_DUCK_LINEAR): Buffer {
  if (mulaw.length === 0 || gain >= 0.999) return mulaw;
  return encodeMulaw(applyLinearGainPcm16(decodeMulaw(mulaw), gain));
}

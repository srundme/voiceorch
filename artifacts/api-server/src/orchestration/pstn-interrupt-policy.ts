/**
 * Bolna interruption. Words + accidental phrases cut TTS.
 * Cancel is sequence_id: invalidate N, mute carrier, abort TTS/LLM.
 */
import { isHoldRequest } from "./conversationDiscipline.js";
import { InterruptionManager } from "./interruption-manager.js";
import { isAccidentalInterruptPhrase, isBackchannelOnlyUtterance } from "./transcriptQuality.js";

export function isPstnStopHold(text: string, interruptionMgr: InterruptionManager): boolean {
  const t = text.trim();
  if (!t) return false;
  return interruptionMgr.isImmediateInterruptPhrase(t)
    || isHoldRequest(t)
    || isAccidentalInterruptPhrase(t);
}

/** Empty transcripts are not turns; nonempty opener speech must be retained. */
export function shouldDiscardOpenerTranscript(
  transcript: string,
  _interruptionMgr: InterruptionManager,
): boolean {
  return !transcript.trim();
}

/** After a barge with no committed caller turn, resume listening (room chatter). */
export const BARGE_STUCK_RESUME_MS = 3500;

export function shouldAbandonStuckBarge(opts: {
  bargeAgeMs: number;
  stuckResumeMs?: number;
}): boolean {
  return opts.bargeAgeMs >= (opts.stuckResumeMs ?? BARGE_STUCK_RESUME_MS);
}

export function shouldCutTtsFromCallerTranscript(opts: {
  transcript: string;
  agentSpeaking: boolean;
  greetingPlaybackActive: boolean;
  systemPlaybackActive?: boolean;
  inEchoGrace?: boolean;
  isSelfEcho?: boolean;
  interruptionMgr: InterruptionManager;
  /** Loudest inbound RMS since this sentence started. 0 / omitted = unknown (do not veto). */
  peakRawRms?: number;
  /** Far-field / next-seat talk must not cut TTS (stop/hold still cut). */
  minBargeRms?: number;
}): boolean {
  const t = opts.transcript.trim();
  if (!t) return false;
  if (!opts.agentSpeaking) return false;
  if (opts.isSelfEcho) return false;
  if (isPstnStopHold(t, opts.interruptionMgr)) return true;
  const welcomePlayed = !(opts.greetingPlaybackActive || !!opts.systemPlaybackActive);
  if (opts.inEchoGrace) return false;
  // "yes" / "okay okay" are answers, not barges — unless they are hold/stop.
  if (isBackchannelOnlyUtterance(t)) {
    return false;
  }
  const minRms = opts.minBargeRms;
  const peak = opts.peakRawRms ?? 0;
  if (minRms != null && peak > 0 && peak < minRms) {
    return false;
  }
  const words = t.split(/\s+/).filter(Boolean).length;
  return opts.interruptionMgr.shouldTriggerInterruption(words, t, true, welcomePlayed);
}

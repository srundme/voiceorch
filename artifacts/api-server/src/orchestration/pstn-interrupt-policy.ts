/**
 * Bolna interruption. Words + accidental phrases cut TTS.
 * Cancel is sequence_id: invalidate N, mute carrier, abort TTS/LLM.
 */
import { isHoldRequest } from "./conversationDiscipline.js";
import { InterruptionManager } from "./interruption-manager.js";
import { isAccidentalInterruptPhrase } from "./transcriptQuality.js";

export function isPstnStopHold(text: string, interruptionMgr: InterruptionManager): boolean {
  const t = text.trim();
  if (!t) return false;
  return interruptionMgr.isImmediateInterruptPhrase(t)
    || isHoldRequest(t)
    || isAccidentalInterruptPhrase(t);
}

/** Bolna `discard_pre_welcome_utterance`: drop opener-window STT entirely. */
export function shouldDiscardOpenerTranscript(
  _transcript: string,
  _interruptionMgr: InterruptionManager,
): boolean {
  return true;
}

export function shouldCutTtsFromCallerTranscript(opts: {
  transcript: string;
  agentSpeaking: boolean;
  greetingPlaybackActive: boolean;
  systemPlaybackActive?: boolean;
  inEchoGrace?: boolean;
  isSelfEcho?: boolean;
  interruptionMgr: InterruptionManager;
}): boolean {
  const t = opts.transcript.trim();
  if (!t) return false;
  if (!opts.agentSpeaking) return false;
  if (opts.isSelfEcho) return false;
  const welcomePlayed = !(opts.greetingPlaybackActive || !!opts.systemPlaybackActive);
  const words = t.split(/\s+/).filter(Boolean).length;
  return opts.interruptionMgr.shouldTriggerInterruption(words, t, true, welcomePlayed);
}

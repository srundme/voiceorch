/**
 * Bolna interruption. Energy / VAD only inspects. Words + stop/wait cut TTS.
 * Cancel is sequence_id: invalidate N, mute carrier, abort TTS/LLM.
 */
import { isHoldRequest } from "./conversationDiscipline.js";
import { InterruptionManager } from "./interruption-manager.js";
import {
  isAccidentalInterruptPhrase,
  isCallerAudioDifficulty,
  isSemanticInterrupt,
} from "./transcriptQuality.js";

export function isPstnStopHold(text: string, interruptionMgr: InterruptionManager): boolean {
  const t = text.trim();
  if (!t) return false;
  return interruptionMgr.isImmediateInterruptPhrase(t)
    || isHoldRequest(t)
    || isAccidentalInterruptPhrase(t);
}

/** First-speech mute: discard opener-window STT unless the caller said stop/hold. */
export function shouldDiscardOpenerTranscript(
  transcript: string,
  interruptionMgr: InterruptionManager,
): boolean {
  const t = transcript.trim();
  if (!t) return true;
  if (
    isSemanticInterrupt(t)
    || isHoldRequest(t)
    || interruptionMgr.isImmediateInterruptPhrase(t)
    || isCallerAudioDifficulty(t)
  ) {
    return false;
  }
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

/**
 * PSTN interruption policy (no carrier AEC).
 *
 * vad.speech_start inspects speech. Only a usable STT partial can cut TTS.
 * Default floor is 2 words while the agent is speaking; ambiguous/low-confidence
 * rises to 3; stop/hold is immediate. Do not raise the global floor to 3.
 */
import { shouldBargeOnRealtimeVadStart } from "./adapters/stt/sarvam-realtime.js";
import { isHoldRequest } from "./conversationDiscipline.js";
import { InterruptionManager } from "./interruption-manager.js";
import {
  isAccidentalInterruptPhrase,
  isCallerAttentionUtterance,
  isCallerAudioDifficulty,
  isDomainOrAcronymAnswer,
  isLikelyCrosstalkUtterance,
  isSemanticInterrupt,
  looksLikeBookingTimeAnswer,
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
  if (opts.isSelfEcho || isLikelyCrosstalkUtterance(t)) return false;
  if (isCallerAttentionUtterance(t) && !isCallerAudioDifficulty(t)) return false;
  const stopHold = isPstnStopHold(t, opts.interruptionMgr) || isCallerAudioDifficulty(t);
  const booking = looksLikeBookingTimeAnswer(t) || isDomainOrAcronymAnswer(t);
  const inOpener = opts.greetingPlaybackActive || !!opts.systemPlaybackActive;
  if (!shouldBargeOnRealtimeVadStart({
    agentSpeaking: true,
    greetingOrSystem: inOpener,
    inEchoGrace: !!opts.inEchoGrace,
    hasUsablePartial: true,
    isHardInterrupt: stopHold || (!inOpener && booking),
  })) return false;
  if (stopHold) return true;
  const words = t.split(/\s+/).filter(Boolean).length;
  return opts.interruptionMgr.shouldTriggerInterruption(words, t, true, !inOpener);
}

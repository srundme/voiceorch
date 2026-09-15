/**
 * Interrupt TTS when the STT provider emitted caller text.
 * Sequence cancel still lives in InterruptionManager.
 */
import { InterruptionManager } from "./interruption-manager.js";

export function isPstnStopHold(text: string, interruptionMgr: InterruptionManager): boolean {
  const t = text.trim();
  if (!t) return false;
  return interruptionMgr.isImmediateInterruptPhrase(t);
}

/** Empty transcripts are not turns. */
export function shouldDiscardOpenerTranscript(
  transcript: string,
  _interruptionMgr: InterruptionManager,
): boolean {
  return !transcript.trim();
}

export const BARGE_STUCK_RESUME_MS = Number.POSITIVE_INFINITY;

export function shouldAbandonStuckBarge(_opts: {
  bargeAgeMs: number;
  stuckResumeMs?: number;
}): boolean {
  return false;
}

export function shouldCutTtsFromCallerTranscript(opts: {
  transcript: string;
  agentSpeaking: boolean;
  greetingPlaybackActive: boolean;
  systemPlaybackActive?: boolean;
  inEchoGrace?: boolean;
  interruptionMgr: InterruptionManager;
  peakRawRms?: number;
  minBargeRms?: number;
}): boolean {
  return opts.agentSpeaking && opts.transcript.trim().length > 0;
}

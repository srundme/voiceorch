/**
 * Acoustic AMD confirmation helpers — keep ringback from looking like a human
 * "hello?" (QA: agent speaks while phone still ringing).
 */

/** Max continuous energy for a single "hello?" vs ring cadence / VM monologue. */
export const AMD_HUMAN_UTTERANCE_MAX_MS = 900;

/**
 * Ringback is short tone bursts with gaps. Two+ short bursts in the confirm
 * window must NOT resolve as human short-utterance (calls 28294, 28406).
 */
export function isLikelyRingBurstPattern(opts: {
  speechBurstCount: number;
  maxContinuousMs: number;
  humanUtteranceMaxMs?: number;
}): boolean {
  const cap = opts.humanUtteranceMaxMs ?? AMD_HUMAN_UTTERANCE_MAX_MS;
  return opts.speechBurstCount >= 2 && opts.maxContinuousMs < cap;
}

/**
 * True when energy pattern looks like a live short hello (one brief run, then pause).
 */
export function isHumanShortUtterancePause(opts: {
  heardSpeech: boolean;
  currentlyInSpeechRun: boolean;
  speechBurstCount: number;
  maxContinuousMs: number;
  continuousBarMs: number;
  sinceSpeechMs: number;
  humanPauseMs: number;
  humanUtteranceMaxMs?: number;
}): boolean {
  if (!opts.heardSpeech || opts.currentlyInSpeechRun) return false;
  if (opts.sinceSpeechMs < opts.humanPauseMs) return false;
  if (opts.maxContinuousMs >= opts.continuousBarMs) return false;
  if (isLikelyRingBurstPattern(opts)) return false;
  const cap = opts.humanUtteranceMaxMs ?? AMD_HUMAN_UTTERANCE_MAX_MS;
  // One short burst only — multi-burst = ring or chatter.
  if (opts.speechBurstCount > 1) return false;
  return opts.maxContinuousMs > 0 && opts.maxContinuousMs < cap;
}

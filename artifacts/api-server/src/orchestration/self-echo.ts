/**
 * Carrier self-echo rejection.
 *
 * PSTN legs (Vobiz / Twilio / Plivo) route a portion of our own TTS back to us
 * as inbound "caller" audio. There is no AEC on a carrier leg, so STT happily
 * transcribes it and the pipeline sees a caller turn that never happened: the
 * agent barges in on itself and answers its own last sentence while the caller
 * is silent.
 *
 * This is deliberately *not* a heuristic about what callers say — no phrase
 * lists, no word floors, no energy thresholds, and it never inspects audio. It
 * compares a transcript against the lines we ourselves just sent to TTS, which
 * is information we own. Barge-in policy is untouched: a real caller talking
 * over the agent is not quoting the agent, so they never match here and still
 * cut the agent off on word count alone.
 *
 * The audio feed to STT stays ungated (see the invariant in
 * `pipeline.handleProcessedAudio`) — this filters transcripts, not frames.
 */

/**
 * A caller must produce at least this many words before a match counts as echo.
 * Real answers are short ("yes", "okay", "Chennai", "I am a fresher") and share
 * common words with the agent's own script, so short finals are always treated
 * as genuine caller speech.
 */
export const SELF_ECHO_MIN_WORDS = 4;

/**
 * Share of the transcript's words that must also appear in one recently spoken
 * agent line. Echo comes back degraded — dropped articles, merged words, wrong
 * inflections — so an exact substring match misses most of it, while a high
 * overlap bar keeps genuine caller turns out of the filter.
 */
export const SELF_ECHO_MIN_OVERLAP = 0.8;

export interface RecentAgentLine {
  /** Normalized word set for a line the agent spoke (or is speaking). */
  readonly tokens: ReadonlySet<string>;
}

export interface SelfEchoCheck {
  /** Normalized words of the caller transcript under test. */
  readonly tokens: readonly string[];
  /** Lines the agent recently sent to TTS, newest last. */
  readonly recentAgentSpeech: readonly RecentAgentLine[];
  /**
   * Our TTS is on the wire right now, or its tail is still audible on the leg.
   * Outside this window there is nothing of ours left to echo, so transcripts
   * are always the caller's.
   */
  readonly agentAudible: boolean;
}

/** Fraction of `tokens` present in `spoken`. */
function overlap(tokens: readonly string[], spoken: ReadonlySet<string>): number {
  if (tokens.length === 0) return 0;
  let hits = 0;
  for (const token of tokens) {
    if (spoken.has(token)) hits++;
  }
  return hits / tokens.length;
}

/**
 * True when this transcript is our own voice coming back off the carrier.
 * Callers must discard such a transcript *before* barge-in evaluation —
 * otherwise the echo cuts the agent's own sentence even though the turn itself
 * is then thrown away.
 */
export function isSelfEcho(check: SelfEchoCheck): boolean {
  if (!check.agentAudible) return false;
  if (check.tokens.length < SELF_ECHO_MIN_WORDS) return false;
  return check.recentAgentSpeech.some(
    (line) => line.tokens.size > 0 && overlap(check.tokens, line.tokens) >= SELF_ECHO_MIN_OVERLAP,
  );
}

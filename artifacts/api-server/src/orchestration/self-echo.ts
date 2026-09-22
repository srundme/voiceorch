/**
 * Carrier self-echo rejection.
 *
 * PSTN legs (Vobiz / Twilio / Plivo) can still route a portion of our own TTS
 * back as inbound "caller" audio. WebRTC AEC3 cancels linear echo on the PCM
 * path; this module is the transcript-level belt-and-suspenders filter for
 * residual / non-linear cases AEC3 misses.
 *
 * This is deliberately *not* a heuristic about what callers say — no phrase
 * lists, no energy thresholds, and it never inspects audio. It compares a
 * transcript against the lines we ourselves just sent to TTS, which is
 * information we own. Barge-in policy is untouched: a real caller talking
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
 * 0.72 catches QA 28437-style mangled greeting echoes without swallowing
 * partial caller reuse of script words.
 */
export const SELF_ECHO_MIN_OVERLAP = 0.72;

/**
 * Latin STT of Indic TTS is often a 4–7 word hallucination with zero lexical
 * overlap (call 26668: "There's the lamb, the lamb." while the agent asked a
 * Tamil funds question). The short-junk path only covers <4 words, so those
 * partials used to barge the agent. Cap the script-mismatch rule below a
 * real English sentence so a bilingual caller can still interrupt.
 */
export const SELF_ECHO_SCRIPT_MISMATCH_MAX_WORDS = 8;

/** Devanagari through Malayalam — the Indic scripts SnapServe PSTN agents speak. */
const INDIC_SCRIPT_RE = /[\u0900-\u0D7F]/;

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
  /**
   * Bytes are leaving TTS right now, or we just cut TTS on a barge that may
   * itself have been sidetone (call 25295). The 2s audible tail after a
   * natural finish is *not* this: short answers like "Chennai" must land.
   */
  readonly ttsOnWire?: boolean;
  /**
   * A short, high-priority caller intent (for example "stop", "wrong number",
   * or "call later"). Content overlap can still prove that a longer utterance
   * is echo, but an unrelated short command must never be discarded merely
   * because TTS happens to be on the wire.
   */
  readonly protectedShortIntent?: boolean;
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

function maxOverlap(tokens: readonly string[], lines: readonly RecentAgentLine[]): number {
  let best = 0;
  for (const line of lines) {
    if (line.tokens.size === 0) continue;
    best = Math.max(best, overlap(tokens, line.tokens));
  }
  return best;
}

function tokensLookLatinOnly(tokens: readonly string[]): boolean {
  let hasLatin = false;
  for (const t of tokens) {
    if (INDIC_SCRIPT_RE.test(t)) return false;
    if (/[a-z]/i.test(t)) hasLatin = true;
  }
  return hasLatin;
}

function recentSpeechHasIndic(lines: readonly RecentAgentLine[]): boolean {
  for (const line of lines) {
    for (const t of line.tokens) {
      if (INDIC_SCRIPT_RE.test(t)) return true;
    }
  }
  return false;
}

/**
 * Bytes are leaving TTS, or we just cut TTS on a barge whose tail is still
 * on the leg. A sticky `bargeInRequested` with no recent TTS frame is *not*
 * on the wire (call 26668 discarded "Hello" 17s later with isPlaying=false).
 */
export function isTtsOnWireForEcho(opts: {
  isPlaying: boolean;
  isSendingTtsAudio: boolean;
  bargeInRequested: boolean;
  msSinceLastTtsFrame: number;
  tailMs: number;
}): boolean {
  if (opts.isPlaying || opts.isSendingTtsAudio) return true;
  if (!opts.bargeInRequested) return false;
  return opts.msSinceLastTtsFrame >= 0 && opts.msSinceLastTtsFrame < opts.tailMs;
}

/**
 * True when this transcript is our own voice coming back off the carrier.
 * Callers must discard such a transcript *before* barge-in evaluation —
 * otherwise the echo cuts the agent's own sentence even though the turn itself
 * is then thrown away.
 */
export function isSelfEcho(check: SelfEchoCheck): boolean {
  if (!check.agentAudible) return false;
  if (check.tokens.length === 0) return false;
  const hit = maxOverlap(check.tokens, check.recentAgentSpeech);
  if (check.tokens.length >= SELF_ECHO_MIN_WORDS && hit >= SELF_ECHO_MIN_OVERLAP) return true;
  // Greeting / short agent line echoed early (QA 28437): 3+ words, high
  // overlap, TTS still on the wire — treat as echo even under the word floor.
  if (
    check.ttsOnWire
    && check.tokens.length >= 3
    && check.tokens.length < SELF_ECHO_MIN_WORDS
    && hit >= SELF_ECHO_MIN_OVERLAP
  ) return true;
  // Sidetone STT is often a short junk fragment with none of our words
  // (call 25295: "Camera", "Downward"). Cap at 2 words so a 3-word city/name
  // answer is not swallowed while TTS finishes.
  if (
    !check.protectedShortIntent
    && check.ttsOnWire
    && check.tokens.length > 0
    && check.tokens.length <= 2
    && hit === 0
  ) return true;
  // Call 26668: five Latin words, zero overlap, Tamil TTS still playing.
  if (
    !check.protectedShortIntent
    && check.ttsOnWire
    && hit === 0
    && check.tokens.length <= SELF_ECHO_SCRIPT_MISMATCH_MAX_WORDS
    && tokensLookLatinOnly(check.tokens)
    && recentSpeechHasIndic(check.recentAgentSpeech)
  ) return true;
  return false;
}

/**
 * Adaptive endpointing — replaces the flat VAD_SILENCE_MS constant with a
 * context-sensitive silence window that adapts to what the caller is saying
 * and what the agent last asked for.
 *
 * Used by both pipeline.ts (batch telephony path) and webcall.ts (browser WS).
 *
 * Priority order (highest wins):
 *  1. Digit-collection context  — agent asked for policy/phone/OTP → wait 800 ms+
 *  2. Partial transcript text   — streaming STT supplied a partial to analyse
 *  3. Audio duration proxy      — batch path: short burst → fast, long → base
 *  4. baseSilenceMs fallback    — agent-configured override or module default
 */

// ── Named threshold constants ─────────────────────────────────────────────────
/** Snappy flush: "yes", "no", ends in "." / "?" */
export const ENDPOINT_FAST_MS        = 150;
/** Neutral baseline — snappier default endpointing window (was 250ms). */
export const ENDPOINT_DEFAULT_MS     = 150;
/** Mid-thought: ends in conjunction / filler word ("and", "so", "um"). */
export const ENDPOINT_LONG_MS        = 600;
/** Digit-collection: caller is reading a policy/phone/OTP number. */
export const ENDPOINT_DIGIT_MS       = 800;
/** Digit-collection AND partial transcript ends in a digit (still reading). */
export const ENDPOINT_DIGIT_TRAIL_MS = 900;

export interface EndpointDecision {
  ms: number;
  /** Short label for the turn_latency log — no PII, no raw text. */
  reason: string;
}

// ── Digit-collection keyword list ─────────────────────────────────────────────
// When the AGENT's last utterance contains any of these phrases, we enter
// digit-collection mode: the silence window is held long so the caller can
// read out a number slowly, pausing between digits.
const DIGIT_KEYWORDS = [
  "policy number", "phone number", "mobile number", "contact number",
  "date of birth", "dob", "otp", "one-time password", "pin", "passcode",
  "id number", "account number", "card number", "aadhaar", "aadhar",
  "reference number", "registration number", "vehicle number", "claim number",
  "zip code", "postal code", "passport number", "license number",
  "membership number", "booking id", "ticket number", "pan number", "gstin",
  "vin number", "vehicle identification", "employee id", "student id",
  "order number", "invoice number", "tracking number", "case number",
  "folio number", "application number",
];

/**
 * Returns true when the agent's last utterance appears to be requesting
 * a number the caller will read digit-by-digit.
 */
export function isDigitCollectionContext(lastAgentText: string): boolean {
  const lower = lastAgentText.toLowerCase();
  for (const kw of DIGIT_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

// ── Dangling / mid-utterance words ────────────────────────────────────────────
// If the partial transcript ends with one of these the caller is likely
// mid-sentence — wait longer before flushing to STT.
const DANGLING_WORDS = new Set([
  "and", "so", "but", "or", "my", "the", "a", "an", "its", "it's",
  "to", "of", "in", "for", "with", "um", "uh", "er", "like", "i",
  "because", "if", "when", "while", "as", "then", "also", "well",
  "this", "that", "these", "those", "there", "here",
  "we", "you", "they", "he", "she", "is", "was", "are",
  "were", "will", "would", "can", "could", "should",
  "what", "which", "who", "how", "where",
  "plus", "however", "actually", "basically",
]);

// ── Affirmation / clearly-complete single words ───────────────────────────────
const AFFIRMATIONS = new Set([
  "yes", "no", "yeah", "nope", "yep", "yup", "sure", "ok", "okay",
  "correct", "right", "true", "false", "done", "bye", "goodbye",
  "thanks", "thank", "fine", "good", "great", "perfect", "proceed",
  "confirm", "confirmed", "agreed", "understood", "hello", "hi", "hey",
  "alright", "alrighty", "roger", "absolutely", "definitely", "certainly",
  "negative", "affirmative", "stop", "cancel", "continue", "ready",
  "received", "noted",
]);

/**
 * Compute the adaptive silence window (ms) to wait before flushing audio to STT.
 */
export function computeEndpointMs(opts: {
  /** Last agent utterance text — used to detect digit-collection context. */
  lastAgentText: string;
  /**
   * Partial transcript from streaming STT, if any.
   * Pass empty string when unavailable (batch STT path).
   */
  partialTranscript: string;
  /** Approximate speech duration in ms derived from accumulated audio bytes. */
  audioBufferMs: number;
  /** Agent-configured base silence window (user override). */
  baseSilenceMs: number;
}): EndpointDecision {
  const { lastAgentText, partialTranscript, audioBufferMs, baseSilenceMs } = opts;

  // ── 1. Digit-collection context (highest priority) ─────────────────────────
  if (isDigitCollectionContext(lastAgentText)) {
    const partial = partialTranscript.trim();
    if (partial.length > 0 && /\d$/.test(partial)) {
      // Still actively reading digits — extend even further
      return { ms: ENDPOINT_DIGIT_TRAIL_MS, reason: "digit-collection:trailing-digit" };
    }
    return { ms: ENDPOINT_DIGIT_MS, reason: "digit-collection" };
  }

  // ── 2. Partial transcript analysis (streaming STT active) ──────────────────
  const partial = partialTranscript.trim().toLowerCase();
  if (partial.length > 0) {
    // Clearly complete: terminal punctuation added by STT smart_format
    if (/[.?!।]$/.test(partial)) {
      return { ms: ENDPOINT_FAST_MS, reason: "terminal-punctuation" };
    }

    // Single-word affirmation ("yes", "okay", "correct", …)
    if (AFFIRMATIONS.has(partial)) {
      return { ms: ENDPOINT_FAST_MS, reason: "affirmation" };
    }

    // Ends in a dangling/filler word — likely mid-utterance
    const lastWord = partial.split(/\s+/).pop() ?? "";
    if (DANGLING_WORDS.has(lastWord)) {
      return { ms: ENDPOINT_LONG_MS, reason: `dangling:${lastWord}` };
    }

    // Very short partial (1–2 words) with short audio — might still be mid-thought
    const wordCount = partial.split(/\s+/).length;
    if (wordCount <= 2 && audioBufferMs < 800) {
      return { ms: Math.max(baseSilenceMs, ENDPOINT_DEFAULT_MS), reason: "short-partial" };
    }
  }

  // ── 3. Audio duration proxy (batch path — no partial transcript available) ─
  if (partial.length === 0) {
    // Short audio burst: likely a quick single-word answer
    if (audioBufferMs > 0 && audioBufferMs < 600) {
      return { ms: ENDPOINT_FAST_MS, reason: "short-audio" };
    }
  }

  // ── 4. Fallback: agent-configured baseline ─────────────────────────────────
  return { ms: baseSilenceMs, reason: "base" };
}

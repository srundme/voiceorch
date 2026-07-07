/**
 * Filler/backchannel guard for passive language auto-detection.
 *
 * Problem: per-turn language detection is Unicode-script based — any Latin-only
 * transcript is classified as English with no minimum length or filler exclusion.
 * In a Tamil/Hindi conversation a caller backchannel like "okay", "thank you",
 * "oh okay", or "yes" flips the detected language to English for the next turn,
 * so the agent replies in English once and then flips back — a jarring blip.
 *
 * Fix: when the current conversation language is non-English and script
 * detection says English, hold the current language unless the utterance passes
 * a "real English" test: at least MIN_REAL_ENGLISH_WORDS words AND at least one
 * word outside the borrowed-filler/backchannel stoplist.
 *
 * Explicit-request latching and Indic-script detection bypass this guard
 * entirely (handled by the caller in resolveAutoDetectLanguage).
 */

/** Minimum word count before a Latin-only utterance can count as real English. */
const MIN_REAL_ENGLISH_WORDS = 3;

/**
 * Borrowed English fillers / backchannels / romanized Indic acknowledgments that
 * are normal inside an Indian-language conversation and are NOT evidence the
 * caller has switched to English. Lowercase, apostrophes/punctuation stripped.
 */
const FILLER_WORDS = new Set([
  // acknowledgments / backchannels
  "okay", "ok", "okk", "kk", "k", "okie", "oky", "oh", "ohh", "o", "oho",
  "ah", "ahh", "aha", "um", "uh", "hmm", "hm", "mm", "mmm", "huh",
  "yes", "yeah", "yep", "yup", "ya", "yaa", "s",
  "no", "nope", "nah", "na",
  // thanks / politeness
  "thank", "thanks", "thankyou", "you", "welcome", "please", "sorry",
  "so", "much", "very",
  // agreement / evaluation
  "right", "alright", "correct", "exactly", "fine", "good", "great",
  "nice", "cool", "super", "wow", "perfect", "sure", "done", "got", "it",
  // greetings / closings
  "hello", "hi", "hey", "bye", "byee", "goodbye", "tata",
  "sir", "madam", "maam",
  // romanized Indic backchannels (Latin script, but not English at all)
  "haan", "han", "ha", "hn", "ji", "hai", "nahi", "nhi",
  "acha", "accha", "achha", "theek", "thik", "sari", "seri", "sarì",
  "ama", "aama", "illa", "illai",
  // hold-on fragments
  "wait", "hold", "on", "one", "sec", "second", "minute",
]);

/** Split into normalized lowercase words; apostrophes and punctuation removed. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * True when a Latin-only transcript looks like the caller genuinely conversing
 * in English (rather than a borrowed filler/backchannel): it has at least
 * MIN_REAL_ENGLISH_WORDS words AND at least one word outside the stoplist.
 */
export function isRealEnglishUtterance(text: string): boolean {
  const words = tokenize(text);
  if (words.length < MIN_REAL_ENGLISH_WORDS) return false;
  return words.some((w) => !FILLER_WORDS.has(w));
}

export interface AutoDetectResolution {
  /** The language to set as the conversation language (null = leave unchanged). */
  lang: string | null;
  /** True when the filler guard suppressed an English flip (for logging). */
  heldFiller: boolean;
}

/**
 * Resolve the per-turn auto-detected conversation language.
 *
 * Precedence:
 *  1. A latched explicit request always wins (bypasses the guard).
 *  2. Indic-script detection passes through unchanged.
 *  3. Script-detected English is held back when the conversation is already in
 *     a non-English language and the utterance is a short filler/backchannel.
 *  4. First-turn English (no current language, or current language already
 *     English) passes through unchanged.
 */
export function resolveAutoDetectLanguage(opts: {
  /** Result of STT-provided or script-based detection (may be null). */
  detected: string | null;
  /** Sticky explicitly-requested language, if any. */
  latchedLang: string | null;
  /** Current conversation language ("" if not yet established). */
  currentLang: string;
  /** The caller's transcript for this turn. */
  text: string;
}): AutoDetectResolution {
  if (opts.latchedLang) return { lang: opts.latchedLang, heldFiller: false };
  const detected = opts.detected;
  if (
    detected &&
    detected.startsWith("en-") &&
    opts.currentLang &&
    !opts.currentLang.startsWith("en-") &&
    !isRealEnglishUtterance(opts.text)
  ) {
    return { lang: opts.currentLang, heldFiller: true };
  }
  return { lang: detected, heldFiller: false };
}

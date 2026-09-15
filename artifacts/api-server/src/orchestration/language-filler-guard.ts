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

/**
 * Minimum number of NON-FILLER content words required before a Latin-only
 * utterance is treated as genuine English.
 *
 * Counting only content words (not total words) prevents Sarvam STT artifacts
 * like "direct to the about" (≤1 content word) from triggering a language
 * switch that a sentence with real English nouns/verbs/adjectives will still
 * exceed comfortably.
 */
const MIN_REAL_ENGLISH_WORDS = 4;

/**
 * Borrowed English fillers / backchannels / romanized Indic acknowledgments that
 * are normal inside an Indian-language conversation and are NOT evidence the
 * caller has switched to English. Lowercase, apostrophes/punctuation stripped.
 *
 * Also includes English grammatical function words (articles, prepositions,
 * auxiliaries) that carry zero "this is English" signal on their own and
 * regularly appear in Sarvam's uncertain-audio output for Tamil speech.
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
  "acha", "accha", "achha", "theek", "thik", "sari", "seri", "sar",
  "ama", "aama", "illa", "illai",
  // romanized Hindi/Indic "go ahead / tell me" replies (call 13340: "Aa boliye Ma'am")
  "aa", "boliye", "bolie", "bolo", "boli", "batao", "bataiye",
  "suniye", "suno", "bolna", "baat", "karo", "kijiye", "kripya",
  // continuation crumbs that appear with politeness fillers ("please … more")
  // Do NOT list "tell" / "me" — "Tell me, I'm on the line" is a real prompt
  // for the agent to speak (call 16986), and "please tell me" still holds
  // because it has fewer than MIN_REAL_ENGLISH_WORDS content words.
  "more",
  // hold-on fragments
  "wait", "hold", "on", "one", "sec", "second", "minute",
  // ── English grammatical function words ───────────────────────────────────
  // These appear in Sarvam's output when it is uncertain about Tamil audio
  // ("direct to the about", "okay ma'am is in the") — they carry zero
  // standalone "this is English" signal and must not count toward the content-
  // word threshold.  Genuine English sentences still exceed the threshold easily
  // through their nouns, verbs, and adjectives.
  // Articles
  "a", "an", "the",
  // Prepositions & particles
  "to", "in", "of", "at", "by", "on", "for", "from", "with", "into",
  "about", "up", "out", "off", "over", "under", "as", "if",
  // Copula / auxiliaries
  "is", "are", "was", "be", "am", "been",
  // Coordinating conjunctions
  "and", "or", "but",
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
 * MIN_REAL_ENGLISH_WORDS **content words** — i.e. words not in the filler/
 * function-word stoplist.
 *
 * Counting content words (not total words) is critical: a Sarvam transcription
 * artifact like "Okay ma'am direct to the about" has 6 total words but only
 * 1 content word ("direct") after stripping fillers + function words, so it
 * stays safely below the threshold and does NOT trigger an English switch.
 * A genuine English sentence ("Are there any other features in the app?")
 * still has 5+ content words and correctly triggers.
 */
export function isRealEnglishUtterance(text: string): boolean {
  const words = tokenize(text);
  const contentWordCount = words.filter((w) => !FILLER_WORDS.has(w)).length;
  return contentWordCount >= MIN_REAL_ENGLISH_WORDS;
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
 *  2. An Indic-configured agent does not passively become English just because
 *     STT/LID wrote Latin letters. English STT on Tamil audio looks like a
 *     "real English sentence" (call 21546 Tanglish) — we cannot dictionary-
 *     match every romanized word, so we trust the agent pin until the caller
 *     asks for English (latch) or autoSwitchToEnglish is on.
 *  3. Indic-script detection passes through unchanged.
 *  4. Script-detected English is held back when the conversation is already in
 *     a non-English language and the utterance is a short filler/backchannel.
 *  5. First-turn English (no current language, or current language already
 *     English) passes through unchanged — unless rule 2 applies.
 */
export function resolveAutoDetectLanguage(opts: {
  detected: string | null;
  latchedLang: string | null;
  currentLang: string;
  text: string;
  agentLang?: string | null;
  allowPassiveEnglish?: boolean;
}): AutoDetectResolution {
  return { lang: opts.detected ?? (opts.currentLang || null), heldFiller: false };
}

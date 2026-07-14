// Language-keyed backchannel filler bank.
//
// When backchanneling is enabled, the agent speaks a short filler phrase
// while the LLM warms up, filling the dead silence between the caller
// finishing their sentence and the first agent word.
//
// Keys are base ISO language codes (the part before any region suffix):
// "ta", "hi", "en", "te", "kn", "ml", "mr", "bn", "gu", etc.
// "ta-IN", "hi-IN", "en-US" all resolve to their base code automatically.
//
// Phrases are intentionally short (1-3 syllables) so they don't bleed
// into the real LLM response or annoy the caller.

const BACKCHANNEL_FILLERS: Record<string, string[]> = {
  // Tamil — kept intentionally minimal. Only "okay" and "சரி" (seri) sound
  // natural in sparing use; the rest ("ஆமா", "அப்படியா", "ஓ", "hmm") were
  // overused and made the agent sound scripted/repetitive.
  "ta": [
    "சரி",        // okay / right (seri)
    "hmm",
    "ஆமா",       // mild yes (sparing)
    "okay",       // universal
  ],

  // Hindi — casual spoken acknowledgments
  "hi": [
    "हाँ",        // yes
    "अच्छा",     // I see / okay
    "हम्म",       // hmm
    "ठीक है",    // okay
    "ओह",         // oh
  ],

  // English — standard fillers
  "en": [
    "Got it.",
    "Okay.",
    "Mm-hmm.",
    "I see.",
    "Sure.",
    "Right.",
  ],

  // Telugu
  "te": [
    "సరే",        // okay
    "అవును",     // yes
    "ఓహో",       // oh I see
    "hmm",
  ],

  // Kannada
  "kn": [
    "ಸರಿ",        // okay
    "ಹೌದು",      // yes
    "ಓಹ್",        // oh
    "hmm",
  ],

  // Malayalam
  "ml": [
    "ശരി",        // okay
    "ഉം",          // mm-hmm
    "ആഹ്",        // ah yes
    "okay",
  ],

  // Marathi
  "mr": [
    "हो",          // yes
    "बरं",          // okay
    "अच्छा",      // I see
    "hmm",
  ],

  // Bengali
  "bn": [
    "হ্যাঁ",       // yes
    "বুঝলাম",    // understood
    "ঠিক আছে",  // okay
    "hmm",
  ],

  // Gujarati
  "gu": [
    "હા",           // yes
    "ઠીક",          // okay
    "અચ્છા",     // I see
    "hmm",
  ],
};

export interface BackchannelFillerOptions {
  /** When caller explicitly requested English, only "Okay." is permitted. */
  englishStrictAck?: boolean;
}

/**
 * Resolve the predefined backchannel filler set for an agent's language.
 * Returns an empty array when the language has no predefined set (caller must
 * then skip injecting a filler — never fall back to another language).
 */
export function getBackchannelFillers(
  language: string | null | undefined,
  opts?: BackchannelFillerOptions,
): string[] {
  if (!language) return [];
  const base = language.toLowerCase().split(/[-_]/)[0]!;
  if (base === "en" && opts?.englishStrictAck) return ["Okay."];
  return BACKCHANNEL_FILLERS[base] ?? [];
}

/**
 * Pick one random filler for the language, or null when none is available.
 *
 * When `lastPhrase` is provided and the pool has more than one option, the
 * same phrase is never picked twice in a row — avoids the robotic feel of
 * hearing e.g. "okay" back-to-back on consecutive turns.
 */
export function pickBackchannelFiller(
  language: string | null | undefined,
  lastPhrase?: string | null,
  opts?: BackchannelFillerOptions,
): string | null {
  const pool = getBackchannelFillers(language, opts);
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0]!;
  let choices = pool;
  if (lastPhrase) {
    const filtered = pool.filter((p) => p !== lastPhrase);
    if (filtered.length > 0) choices = filtered;
  }
  return choices[Math.floor(Math.random() * choices.length)]!;
}

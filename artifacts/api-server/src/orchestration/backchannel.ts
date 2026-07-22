// Language-keyed backchannel filler bank with context-safe acknowledgments.
//
// When backchanneling is enabled, the agent speaks a short filler phrase
// while the LLM warms up, filling the dead silence between the caller
// finishing their sentence and the first agent word.
//
// Phrases are intentionally non-committal so they NEVER contradict the
// subsequent LLM answer (e.g. never say "yes/ஆமா/हाँ" before a "no/இல்லை/नहीं" answer).

const BACKCHANNEL_FILLERS: Record<string, string[]> = {
  // Tamil — strictly non-committal acknowledgments (no polar "ஆமா" that can clash with "இல்ல")
  "ta": [
    "சரி",        // okay / right (seri)
    "hmm",
    "okay",       // universal
  ],

  // Hindi — neutral spoken acknowledgments (no polar "हाँ" that can clash with "नहीं")
  "hi": [
    "अच्छा",     // I see / okay
    "हम्म",       // hmm
    "ठीक है",    // okay
  ],

  // English — standard neutral fillers
  "en": [
    "Got it.",
    "Okay.",
    "Mm-hmm.",
    "I see.",
  ],

  // Telugu — non-committal
  "te": [
    "సరే",        // okay
    "ఓహో",       // oh I see
    "hmm",
  ],

  // Kannada — non-committal
  "kn": [
    "ಸರಿ",        // okay
    "ಓಹ್",        // oh
    "hmm",
  ],

  // Malayalam — non-committal
  "ml": [
    "ശരി",        // okay
    "ഉം",          // mm-hmm
    "okay",
  ],

  // Marathi — non-committal
  "mr": [
    "बरं",          // okay
    "अच्छा",      // I see
    "hmm",
  ],

  // Bengali — non-committal
  "bn": [
    "বুঝলাম",    // understood
    "ঠিক আছে",  // okay
    "hmm",
  ],

  // Gujarati — non-committal
  "gu": [
    "ઠીક",          // okay
    "અચ્છા",     // I see
    "hmm",
  ],
};

/** High-priority neutral fillers used when caller asks a question or has a complex prompt */
const STRICT_NEUTRAL_FILLERS: Record<string, string[]> = {
  "ta": ["சரி", "okay"],
  "hi": ["ठीक है", "अच्छा"],
  "en": ["Okay.", "Got it."],
  "te": ["సరే"],
  "kn": ["ಸರಿ"],
  "ml": ["ശരി"],
};

export interface BackchannelFillerOptions {
  /** When caller explicitly requested English, only "Okay." is permitted. */
  englishStrictAck?: boolean;
  /** Custom fillers configured on the agent */
  customFillers?: string[];
  /** Latest caller transcript text for semantic context filtering */
  callerTranscript?: string | null;
}

/**
 * Resolve the predefined backchannel filler set for an agent's language.
 */
export function getBackchannelFillers(
  language: string | null | undefined,
  opts?: BackchannelFillerOptions,
): string[] {
  if (opts?.customFillers && opts.customFillers.length > 0) {
    return opts.customFillers;
  }

  if (!language) return [];
  const base = language.toLowerCase().split(/[-_]/)[0]!;
  if (base === "en" && opts?.englishStrictAck) return ["Okay."];

  // If caller asked a question or transcript has question markers, restrict to strict neutral fillers
  const transcript = opts?.callerTranscript?.trim() || "";
  const isQuestion = transcript.endsWith("?") ||
    /\b(what|why|when|where|how|who|can|is|are|do|does|did|will|would|could|என்ன|எப்போ|ஏன்|எப்படி|யாரு|இருக்கா|வருமா|என்னுடைய|क्या|कब|कहाँ|क्यों|कैसा|कैसे)\b/i.test(transcript);

  if (isQuestion && STRICT_NEUTRAL_FILLERS[base]) {
    return STRICT_NEUTRAL_FILLERS[base]!;
  }

  return BACKCHANNEL_FILLERS[base] ?? [];
}

/**
 * Pick one random filler for the language, or null when none is available.
 * Avoids picking the exact same phrase twice in a row.
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

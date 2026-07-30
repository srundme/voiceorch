// Language-keyed backchannel filler bank with context-safe acknowledgments.
//
// Fillers play BEFORE the LLM reply is known. Affirmative acks ("சரி", "Okay",
// "Sure") before a refusal/negative answer kill the feel — so the default bank
// is listening-only. Soft acks are allowed only when the caller's turn looks
// like a safe, non-polar statement (not a question / complaint / refusal).
//
// Never use polar yes/no (ஆமா / हाँ / yes) as fillers.

/** Pure listening sounds — safe before any answer polarity. */
const LISTENING_FILLERS: Record<string, string[]> = {
  ta: ["ம்ம்", "ஆஹா", "அப்படியா", "ஹ்ம்"],
  hi: ["हम्म", "अच्छा", "उम्म"],
  en: ["Mm-hmm.", "I see.", "Hmm."],
  te: ["ఓహో", "అలాగా", "hmm"],
  kn: ["ಓಹ್", "ಅಲ್ವಾ", "hmm"],
  ml: ["ഉം", "ഓഹ്", "okay"],
  mr: ["अच्छा", "हम्म", "hmm"],
  bn: ["আচ্ছা", "হুম", "hmm"],
  gu: ["અચ્છા", "હમ્", "hmm"],
};

/**
 * Soft acknowledgments — imply "I heard you", not agreement.
 * Only used when caller turn is not a question / risk turn.
 */
const SOFT_ACK_FILLERS: Record<string, string[]> = {
  ta: ["சரிங்க", "புரிஞ்சுது", "ஓகேங்க", "சரி"],
  hi: ["समझ गया", "ठीक है", "अच्छा जी", "ओके"],
  en: ["Got it.", "Understood.", "Okay.", "Right."],
  te: ["సరే", "ఓకే"],
  kn: ["ಸರಿ", "ಓಕೆ"],
  ml: ["ശരി", "ഓക്കേ"],
  mr: ["बरं", "ठीक आहे", "ओके"],
  bn: ["বুঝলাম", "ঠিক আছে", "ওকে"],
  gu: ["સમજાયું", "ઠીક", "ઓકે"],
};

/** How many recent fillers to avoid repeating (ring buffer). */
export const FILLER_RECENT_AVOID = 3;

export interface BackchannelFillerOptions {
  /** When caller explicitly requested English, only "Okay." is permitted. */
  englishStrictAck?: boolean;
  /** Custom fillers configured on the agent */
  customFillers?: string[];
  /** Latest caller transcript text for semantic context filtering */
  callerTranscript?: string | null;
}

/**
 * Caller turns where a soft/positive filler often clashes with a negative
 * agent reply (capability no, cancel, complaint, refusal, price pushback).
 */
export function isRiskyFillerContext(transcript: string): boolean {
  const t = transcript.trim();
  if (!t) return false;

  if (t.endsWith("?")) return true;

  // Questions / capability / availability (any language markers we care about)
  if (
    /\b(what|why|when|where|how|who|can|could|would|will|is|are|do|does|did|may|might)\b/i.test(t)
    || /\b(என்ன|எப்போ|ஏன்|எப்படி|யாரு|இருக்கா|வருமா|முடியுமா|கிடைக்குமா|இருக்காங்களா)\b/i.test(t)
    || /\b(क्या|कब|कहाँ|क्यों|कैसा|कैसे|है\s*क्या|मिल\s*सकता)\b/i.test(t)
  ) {
    return true;
  }

  // Refusal / cancel / complaint / negative polarity from caller
  if (
    /\b(no|not|don'?t|never|cancel|stop|refund|wrong|problem|issue|complaint|expensive|can'?t|won'?t|unable|unavailable|sorry)\b/i.test(t)
    || /\b(இல்லை|வேண்டாம்|ரத்து|நிறுத்து|பிரச்சனை|தவறு|புகார்|விலை|முடியாது|கிடைக்காது|சரியில்லை)\b/i.test(t)
    || /\b(नहीं|मत|रद्द|बंद|समस्या|गलत|शिकायत|महंगा|नहीं\s*चाहिए)\b/i.test(t)
  ) {
    return true;
  }

  return false;
}

function languageBase(language: string): string {
  return language.toLowerCase().split(/[-_]/)[0]!;
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
  const base = languageBase(language);
  if (base === "en" && opts?.englishStrictAck) return ["Okay."];

  const listening = LISTENING_FILLERS[base] ?? [];
  const soft = SOFT_ACK_FILLERS[base] ?? [];
  const transcript = opts?.callerTranscript?.trim() || "";

  // Unknown next-sentence polarity → listening only (safe before "no").
  if (!transcript || isRiskyFillerContext(transcript)) {
    return listening.length > 0 ? listening : soft;
  }

  // Safe statement from caller — allow soft acks + listening for variety.
  const merged = [...listening, ...soft];
  return merged.length > 0 ? merged : [];
}

/**
 * Pick one filler for the language, or null when none is available.
 * Avoids the last few phrases so Tamil/Indic calls don't loop the same sound.
 */
export function pickBackchannelFiller(
  language: string | null | undefined,
  lastPhrase?: string | string[] | null,
  opts?: BackchannelFillerOptions,
): string | null {
  const pool = getBackchannelFillers(language, opts);
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0]!;

  const recent = (Array.isArray(lastPhrase) ? lastPhrase : lastPhrase ? [lastPhrase] : [])
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  let choices = pool;
  if (recent.length > 0) {
    const filtered = pool.filter((p) => !recent.includes(p.trim().toLowerCase()));
    if (filtered.length > 0) choices = filtered;
  }
  return choices[Math.floor(Math.random() * choices.length)]!;
}

/** Push a spoken filler into a recent-avoid ring (mutates `recent`, returns it). */
export function rememberFillerPhrase(recent: string[], phrase: string, max = FILLER_RECENT_AVOID): string[] {
  recent.push(phrase);
  while (recent.length > max) recent.shift();
  return recent;
}

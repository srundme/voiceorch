// Fillers play BEFORE the LLM reply is known, so positive acknowledgements stay
// off questions and refusals where they could sound like agreement.
//
// Pools are short, human phone-style covers — varied by caller-turn context so
// the same "Hmm / Okay" loop does not dominate a call.

export type BackchannelContext = "risky" | "story" | "numeric" | "neutral";

/** Pure listening / backchannel fillers — only Okay. and Ok. */
const ENGLISH_LISTENING_FILLERS = [
  "Okay.",
  "Ok.",
];

const TAMIL_LISTENING_FILLERS = [
  "Okay.",
  "Ok.",
];

const HINDI_LISTENING_FILLERS = [
  "Okay.",
  "Ok.",
];

const HINDI_ACK_FILLERS = [
  "Okay.",
  "Ok.",
];

const TAMIL_SOFT_ACK_FILLERS = [
  "Okay.",
  "Ok.",
];

/** @deprecated Prefer uniform pick + recent-avoid; kept for callers that still import it. */
export const SOFT_ACK_OKAY_WEIGHT = 0.35;

/** How many recent fillers to avoid repeating (ring buffer). */
export const FILLER_RECENT_AVOID = 5;

/** Split the agents.backchannel_phrases text column into spoken cover fillers. */
export function parseBackchannelPhrases(raw: string | null | undefined): string[] | null {
  if (!raw?.trim()) return null;
  const parts = raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : null;
}

export interface BackchannelFillerOptions {
  /** Keep English fillers for an explicitly English-locked conversation. */
  englishStrictAck?: boolean;
  /** Custom fillers configured on the agent */
  customFillers?: string[];
  /** Latest caller transcript text for semantic context filtering */
  callerTranscript?: string | null;
  /** Test hook — defaults to Math.random. */
  rng?: () => number;
}

/**
 * Caller turns where a soft/positive filler often clashes with a negative
 * agent reply (capability no, cancel, complaint, refusal, price pushback).
 */
export function isRiskyFillerContext(transcript: string): boolean {
  const t = transcript.trim();
  if (!t) return false;

  if (t.endsWith("?")) return true;

  // Questions / capability / availability — avoid bare is/are/do (too common in statements).
  if (
    /\b(what|why|when|where|how|who|can|could|would|may|might)\b/i.test(t)
    || /^(will|is|are|do|does|did|have|has)\b/i.test(t)
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

/**
 * Bucket the caller turn so fillers feel situational instead of a fixed 3-word loop.
 */
export function classifyBackchannelContext(transcript: string | null | undefined): BackchannelContext {
  const t = transcript?.trim() || "";
  if (!t || isRiskyFillerContext(t)) return "risky";

  if (
    /\d|₹|\$|rs\.?\b|rupees?|lakh|crore|percent|%|\b(am|pm)\b/i.test(t)
    || /\b(today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(t)
    || /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i.test(t)
    || /\b\d{1,2}[\/\-.]\d{1,2}([\/\-.]\d{2,4})?\b/.test(t)
    || /\b(நாளை|நேத்து|இன்னைக்கு|ரூபாய்|லட்சம்|கோடி)\b/i.test(t)
  ) {
    return "numeric";
  }

  const wordCount = t.split(/\s+/).filter(Boolean).length;
  if (
    wordCount >= 12
    || /\b(and then|after that|also|because|so i|i was|we were|first|second|then i|plus)\b/i.test(t)
    || /\b(அப்பறம்|அப்புறம்|கூடவே|அதனால|முதல்ல|அடுத்தது)\b/i.test(t)
  ) {
    return "story";
  }

  return "neutral";
}

/**
 * Resolve the backchannel filler set for the current language + caller context.
 */
export function getBackchannelFillers(
  language: string | null | undefined,
  opts?: BackchannelFillerOptions,
): string[] {
  if (opts?.customFillers && opts.customFillers.length > 0) {
    return opts.customFillers;
  }

  if (!language) return [];
  const lang = language.toLowerCase().split("-")[0];
  const isTamil = !opts?.englishStrictAck && lang === "ta";
  const isHindi = !opts?.englishStrictAck && lang === "hi";
  const context = classifyBackchannelContext(opts?.callerTranscript);

  if (isTamil) {
    if (context === "risky") return [...TAMIL_LISTENING_FILLERS];
    return [...TAMIL_SOFT_ACK_FILLERS];
  }

  if (isHindi) {
    if (context === "risky") return [...HINDI_LISTENING_FILLERS];
    return [...HINDI_ACK_FILLERS];
  }

  return [...ENGLISH_LISTENING_FILLERS];
}

function nextRandom(opts?: BackchannelFillerOptions): number {
  return opts?.rng?.() ?? Math.random();
}

function pickFrom(choices: string[], opts?: BackchannelFillerOptions): string {
  return choices[Math.floor(nextRandom(opts) * choices.length)]!;
}

/**
 * Pick one filler for the language, or null when none is available.
 * Uses context pools + recent-avoid so covers stay human and non-repetitive.
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
  return pickFrom(choices, opts);
}

/** Push a spoken filler into a recent-avoid ring (mutates `recent`, returns it). */
export function rememberFillerPhrase(recent: string[], phrase: string, max = FILLER_RECENT_AVOID): string[] {
  recent.push(phrase);
  while (recent.length > max) recent.shift();
  return recent;
}

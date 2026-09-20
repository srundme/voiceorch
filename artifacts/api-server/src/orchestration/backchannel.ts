// Fillers play BEFORE the LLM reply is known, so positive acknowledgements stay
// off questions and refusals where they could sound like agreement.

/** Pure listening sounds — safe before any answer polarity. */
const ENGLISH_LISTENING_FILLERS = ["Hmm.", "Mmm."];
const TAMIL_LISTENING_FILLERS = ["ம்.", "ஹ்ம்ம்."];

/** Soft ack — only when the caller turn is not a question / risk turn. */
const ENGLISH_SOFT_ACK_FILLERS = ["Okay.", "Hmm.", "Mmm."];
// Tamil LLMs already open with "சரி," / "seri" — a சரி cover makes "seri seri".
const TAMIL_SOFT_ACK_FILLERS = ["ம்.", "ஹ்ம்ம்."];

/** Share of safe-statement backchannels that should be "Okay." */
export const SOFT_ACK_OKAY_WEIGHT = 0.8;

/** How many recent fillers to avoid repeating (ring buffer). */
export const FILLER_RECENT_AVOID = 3;

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

/**
 * Resolve the backchannel filler set (okay / hmm / mmm only).
 */
export function getBackchannelFillers(
  language: string | null | undefined,
  opts?: BackchannelFillerOptions,
): string[] {
  if (opts?.customFillers && opts.customFillers.length > 0) {
    return opts.customFillers;
  }

  if (!language) return [];
  const isTamil = !opts?.englishStrictAck && language.toLowerCase().split("-")[0] === "ta";
  const listeningFillers = isTamil ? TAMIL_LISTENING_FILLERS : ENGLISH_LISTENING_FILLERS;
  const softAckFillers = isTamil ? TAMIL_SOFT_ACK_FILLERS : ENGLISH_SOFT_ACK_FILLERS;
  const transcript = opts?.callerTranscript?.trim() || "";

  // Unknown next-sentence polarity → listening only (safe before "no").
  if (!transcript || isRiskyFillerContext(transcript)) {
    return [...listeningFillers];
  }

  return [...softAckFillers];
}

function nextRandom(opts?: BackchannelFillerOptions): number {
  return opts?.rng?.() ?? Math.random();
}

function pickFrom(choices: string[], opts?: BackchannelFillerOptions): string {
  return choices[Math.floor(nextRandom(opts) * choices.length)]!;
}

function pickListeningFiller(
  choices: string[],
  recent: string[],
  opts?: BackchannelFillerOptions,
): string {
  const filtered = choices.filter((p) => !recent.includes(p.trim().toLowerCase()));
  return pickFrom(filtered.length > 0 ? filtered : choices, opts);
}

/**
 * Pick one filler for the language, or null when none is available.
 * Safe statements: 80% Okay, 20% Hmm/Mmm. Questions / refusals stay listening-only.
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

  const usingCustom = Boolean(opts?.customFillers && opts.customFillers.length > 0);
  const positiveAck = pool.includes("Okay.") ? "Okay." : null;
  if (!usingCustom && positiveAck) {
    if (nextRandom(opts) < SOFT_ACK_OKAY_WEIGHT) return positiveAck;
    const listening = pool.filter((phrase) => phrase !== positiveAck);
    return pickListeningFiller(listening, recent, opts);
  }

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

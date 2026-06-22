// Language-keyed backchannel filler bank.
//
// When backchanneling is enabled, the agent speaks a short filler phrase while
// the LLM warms up. Phrases are chosen STRICTLY by the agent's language — never
// mixed across languages and never falling back to English. If the resolved
// language has no predefined set, no filler is spoken.
//
// Languages are keyed by their base ISO code (the part before any region
// suffix), so "ta", "ta-IN", "en-US", "en-GB" all resolve correctly.

const BACKCHANNEL_FILLERS: Record<string, string[]> = {
  en: ["Okay, so...", "Got it, got it...", "Sure, sure...", "Let me check...", "Right, so..."],
  ta: ["ஒரு நிமிஷம்...", "ஆமா, ஆமா...", "சரி...", "பாக்கறேன்...", "ம்ம்ம்..."],
  ml: ["ഒരു മിനിറ്റ്...", "ശരി, ശരി...", "അതെ, അതെ...", "നോക്കട്ടെ...", "ഉം..."],
  hi: ["हाँ, हाँ...", "एक सेकंड...", "अच्छा...", "देखता हूँ...", "ठीक है..."],
  kn: ["ಸರಿ, ಸರಿ...", "ಒಂದು ನಿಮಿಷ...", "ಹೌದು, ಹೌದು...", "ನೋಡ್ತೀನಿ...", "ಹೌಂ..."],
  te: ["సరే, సరే...", "ఒక్క నిమిషం...", "అవును, అవును...", "చూస్తాను...", "హ్మ్..."],
  mr: ["हो, हो...", "एक मिनिट...", "बरं...", "बघतो...", "ठीक आहे..."],
};

/**
 * Resolve the predefined backchannel filler set for an agent's language.
 * Returns an empty array when the language has no predefined set (caller must
 * then skip injecting a filler — never fall back to another language).
 */
export function getBackchannelFillers(language: string | null | undefined): string[] {
  if (!language) return [];
  const base = language.toLowerCase().split(/[-_]/)[0]!;
  return BACKCHANNEL_FILLERS[base] ?? [];
}

/** Pick one random filler for the language, or null when none is available. */
export function pickBackchannelFiller(language: string | null | undefined): string | null {
  const pool = getBackchannelFillers(language);
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

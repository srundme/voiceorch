// Language-keyed backchannel filler bank.
//
// When backchanneling is enabled, the agent would speak a short filler phrase
// while the LLM warms up. The default phrase bank has been emptied so no canned
// filler is spoken on any call, in any language. Both the pre-emptive
// backchannel path and the dead-air (slow-LLM) filler path handle an empty pool
// gracefully — they log a skip and inject nothing.
//
// Languages are keyed by their base ISO code (the part before any region
// suffix), so "ta", "ta-IN", "en-US", "en-GB" all resolve correctly.

const BACKCHANNEL_FILLERS: Record<string, string[]> = {};

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

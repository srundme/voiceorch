/**
 * Normalize LLM non-verbal cues before provider dispatch.
 *
 * Cartesia Sonic 3.5+ supports the exact `[laughter]` transcript token. Other
 * bracketed/stage-direction forms are not portable and must not be read aloud.
 * Unresolved prompt placeholders (`{{name}}` when the call has no lead name)
 * are dropped too — the LLM copies them from the prompt verbatim.
 */
export function normalizeTtsNonverbals(text: string, provider: string | null | undefined): string {
  const cartesia = provider?.trim().toLowerCase() === "cartesia";

  return text
    .replace(/\s*\{\{\s*\w+\s*\}\}/g, "")
    .replace(/\[([a-zA-Z0-9_\-\s]+)\]/g, (_match, label: string) =>
      cartesia && label.trim().toLowerCase() === "laughter" ? "[laughter]" : "")
    .replace(/\*+[a-zA-Z0-9_\-\s]+\*+|\([a-zA-Z0-9_\-\s]+\)/gi, "")
    // "Thanisandra / North Bangalore" is read as "slash"; dates like 14/08 have no spaces.
    .replace(/(\p{L})\s+\/\s+(?=\p{L})/gu, "$1 or ");
}

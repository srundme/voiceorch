/**
 * Normalize LLM non-verbal cues before provider dispatch.
 *
 * Cartesia Sonic 3.5+ supports the exact `[laughter]` transcript token. Other
 * bracketed/stage-direction forms are not portable and must not be read aloud.
 */
export function normalizeTtsNonverbals(text: string, provider: string | null | undefined): string {
  const cartesia = provider?.trim().toLowerCase() === "cartesia";

  return text
    .replace(/\[([a-zA-Z0-9_\-\s]+)\]/g, (_match, label: string) =>
      cartesia && label.trim().toLowerCase() === "laughter" ? "[laughter]" : "")
    .replace(/\*+[a-zA-Z0-9_\-\s]+\*+|\([a-zA-Z0-9_\-\s]+\)/gi, "");
}

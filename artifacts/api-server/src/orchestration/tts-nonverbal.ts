/**
 * Normalize LLM non-verbal cues before provider dispatch.
 *
 * Cartesia Sonic 3.5+ supports the exact `[laughter]` transcript token. Other
 * bracketed/stage-direction forms are not portable and must not be read aloud.
 * Unresolved prompt placeholders (`{{name}}` when the call has no lead name)
 * are dropped too — the LLM copies them from the prompt verbatim.
 */
const LAUGHTER_SOFT_FROM_TURN = 2;
const LAUGHTER_REQUIRED_FROM_TURN = 5;

/**
 * Agents whose prompt asks for `[laughter]` (Cartesia only) get a volatile
 * per-turn reminder until one is spoken: a soft "if a light moment fits" from
 * the second caller turn, then a required one so every call laughs at least
 * once — placed by the model, not at a fixed line. Further laughs are left to
 * the prompt.
 */
export function laughterNudge(opts: {
  ttsProvider: string | null | undefined;
  systemPrompt: string | null | undefined;
  laughedAlready: boolean;
  turnIndex: number;
}): string | null {
  if (opts.laughedAlready) return null;
  if (opts.ttsProvider?.trim().toLowerCase() !== "cartesia") return null;
  if (!/\[laughter\]/i.test(opts.systemPrompt ?? "")) return null;
  if (opts.turnIndex < LAUGHTER_SOFT_FROM_TURN) return null;
  if (opts.turnIndex < LAUGHTER_REQUIRED_FROM_TURN) {
    return "[LAUGHTER] You have not laughed yet in this call. If anything in this reply is even slightly light, warm or friendly, add [laughter] at that natural spot. Never right after a price, an objection or a complaint.";
  }
  return "[LAUGHTER — REQUIRED IN THIS REPLY] You must laugh at least once in this call and have not yet. Include [laughter] in this reply at the most natural friendly spot (after a light remark or a warm acknowledgement). Never right after a price, an objection or a complaint.";
}

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

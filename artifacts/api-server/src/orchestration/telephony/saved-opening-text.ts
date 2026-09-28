export const SAVED_OPENING_TEXT = "Hello, this is Sruthi from Jobshop. How may I assist you?";

/** First token of the agent name, same rule as intakeSpokenName. */
function spokenName(agentName: string | null | undefined): string {
  const cleaned = String(agentName ?? "").trim();
  if (!cleaned) return "the recruitment team";
  return cleaned.split(/\s+/)[0]!;
}

/** The saved clip is this one sentence. Any other opener stays on the live voice. */
export function savedOpeningTextFor(agentName: string | null | undefined, greeting: string | null | undefined): string | null {
  const spoken = spokenName(agentName);
  const resolved = String(greeting ?? "").replaceAll("{{agent_name}}", spoken).trim();
  return resolved === SAVED_OPENING_TEXT ? SAVED_OPENING_TEXT : null;
}

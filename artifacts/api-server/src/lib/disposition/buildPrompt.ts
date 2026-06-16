import type { DispositionConfig } from "./types.js";

/**
 * Builds the system prompt for the disposition LLM pass.
 * Prompt is derived entirely from the agent's taxonomy config — never hardcoded.
 */
export function buildPrompt(cfg: DispositionConfig): string {
  const taxonomyJson = JSON.stringify(cfg.taxonomy, null, 2);

  const domainInstructions =
    cfg.domainFields.length > 0
      ? `\nAlso extract these domain-specific fields (set to null if not determinable):\n${cfg.domainFields
          .map((f) => {
            const enumStr = f.enum?.length
              ? ` (allowed values: ${f.enum.join(", ")}, or null)`
              : "";
            return `- ${f.key} (${f.type})${enumStr}`;
          })
          .join("\n")}`
      : "";

  return `You are a call disposition classifier for a voice AI sales/support system.

TAXONOMY — the ONLY valid primary → sub combinations:
${taxonomyJson}

TASK: Analyse the call transcript and classify the CUSTOMER's intent and outcome.

RULES:
- disposition = what the CUSTOMER said/intended, NOT what the agent did
- evidence = single verbatim customer line that best supports the classification
- If no quotable customer line exists → set confidence below 0.5
- Judge intent equally across Hindi, Hinglish, Kannada, and English
- confidence: 0.0 (no signal) to 1.0 (completely certain)
- sub MUST belong to the chosen primary per the taxonomy above
${domainInstructions}

Respond ONLY with valid JSON matching the required schema. No markdown, no extra keys.`;
}

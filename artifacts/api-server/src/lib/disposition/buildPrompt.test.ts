import { describe, expect, it } from "vitest";
import { buildPrompt } from "./buildPrompt.js";

describe("buildPrompt", () => {
  it("injects business outcome guides for the classifier", () => {
    const prompt = buildPrompt({
      agentId: 1,
      taxonomy: { outcome: ["interested", "callback"] },
      domainFields: [
        { key: "whatsapp_number", type: "string", label: "WhatsApp number" },
      ],
      rules: [],
      outcomeGuides: {
        interested: "Asked for pricing or agreed to a site visit this week.",
      },
    });

    expect(prompt).toContain("HOW TO PICK EACH OUTCOME");
    expect(prompt).toContain('"interested": Asked for pricing or agreed to a site visit this week.');
    expect(prompt).toContain("DIGITS ONLY");
    expect(prompt).toContain("spoken as words");
  });
});

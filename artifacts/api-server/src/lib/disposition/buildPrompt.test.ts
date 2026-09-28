import { describe, expect, it } from "vitest";
import { buildPrompt, formatLiveAfterCallBlock } from "./buildPrompt.js";

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

describe("formatLiveAfterCallBlock", () => {
  it("tells the live agent the outcomes and the fields to ask for", () => {
    const block = formatLiveAfterCallBlock({
      taxonomy: { outcome: ["interested", "callback"] },
      domainFields: [{ key: "city", type: "string", label: "City" }],
    });
    expect(block).toContain("interested, callback");
    expect(block).toContain("City");
    expect(block).toContain("Do not read the list out loud");
  });

  it("is empty when the agent has no after-call config", () => {
    expect(formatLiveAfterCallBlock({ taxonomy: {}, domainFields: [] })).toBeNull();
  });
});

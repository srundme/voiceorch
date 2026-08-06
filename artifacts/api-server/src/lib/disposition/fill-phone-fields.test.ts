import { describe, expect, it } from "vitest";
import { fillMissingPhoneFields, findPhonesInTranscript } from "./fill-phone-fields.js";
import type { DispositionConfig, DispositionResult } from "./types.js";

const cfg: DispositionConfig = {
  agentId: 1,
  taxonomy: {
    status: [
      "Ticket Interested - Same Number",
      "Ticket Interested - Alternate Number",
      "Not Interested",
    ],
  },
  domainFields: [{ key: "whatsapp_number", type: "string", label: "WhatsApp number" }],
  rules: [],
};

describe("findPhonesInTranscript", () => {
  it("finds spoken alternate number", () => {
    const tx = `Caller: 683653279\nAgent: <spell>683653279</spell>, correct-ஆ?`;
    expect(findPhonesInTranscript(tx)).toContain("683653279");
  });
});

describe("fillMissingPhoneFields", () => {
  it("fills alternate WhatsApp from transcript when LLM left null", () => {
    const result: DispositionResult = {
      primary: "status",
      sub: "Ticket Interested - Alternate Number",
      confidence: 0.9,
      evidence: "வேற நம்பர் இருக்கு",
      summary: "Alternate WhatsApp for brochure",
      flags: [],
      needsReview: false,
      domainFields: { whatsapp_number: null },
    };
    const tx = `
Caller: இல்ல மேடம் வேற நம்பர் இருக்கு.
Agent: அந்த WhatsApp number மட்டும் சொல்லுங்க.
Caller: 683653279
Agent: 683653279, correct-ஆ?
Caller: हां मैडम
`;
    const out = fillMissingPhoneFields(cfg, result, tx, "918904887300");
    expect(out.domainFields?.["whatsapp_number"]).toBe("683653279");
  });

  it("fills called number for same-number outcome", () => {
    const result: DispositionResult = {
      primary: "status",
      sub: "Ticket Interested - Same Number",
      confidence: 0.9,
      evidence: "same number",
      summary: "Send on this line",
      flags: [],
      needsReview: false,
    };
    const out = fillMissingPhoneFields(cfg, result, "Caller: same number ok", "918904887300");
    expect(out.domainFields?.["whatsapp_number"]).toBe("918904887300");
  });
});

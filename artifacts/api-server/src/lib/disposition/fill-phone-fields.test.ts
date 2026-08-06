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
Caller: 6836532790
Agent: 6836532790, correct-ஆ?
Caller: हां मैडम
`;
    const out = fillMissingPhoneFields(cfg, result, tx, "918904887300");
    expect(out.domainFields?.["whatsapp_number"]).toBe("6836532790");
  });

  it("merges Tamil spoken digits + fragment into WhatsApp (call 6062 shape)", () => {
    const result: DispositionResult = {
      primary: "status",
      sub: "Ticket Interested - Alternate Number",
      confidence: 0.85,
      evidence: "இல்லை இல்லை வேற நம்பர் இருக்கு",
      summary: "Alternate WhatsApp dictated in parts",
      flags: [],
      needsReview: false,
      domainFields: { whatsapp_number: null },
    };
    const tx = `
Caller: இல்லை இல்லை வேற நம்பர் இருக்கு
Agent: அப்போ உங்க சரியான WhatsApp நம்பரைக் கொஞ்சம் சொல்லுவீங்களா?
Caller: இந்த நம்பர்ல வாட்ஸ்அப் இல்ல
Agent: அப்போ அந்த சரியான WhatsApp நம்பரை கொஞ்சம் சொல்லுங்க Joshua.
Caller: எயிட் நைன் ஜிரோ ஃபோர்.
Agent: எட்டு, ஒன்பது, பூஜ்ஜியம், நான்கு, அடுத்த நம்பர் என்னங்க?
Caller: 74887400.
Caller: டபுள் ஜீரோ.
`;
    const out = fillMissingPhoneFields(cfg, result, tx, "918904887300");
    expect(out.domainFields?.["whatsapp_number"]).toBe("8904748874");
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

import { describe, expect, it } from "vitest";
import {
  clampDispositionText,
  extractBarePhone,
  formatDispositionFieldList,
  isPhoneLikeDispositionField,
  normalizeDispositionSchemaResult,
} from "./normalize-fields.js";

describe("isPhoneLikeDispositionField", () => {
  it("matches whatsapp / phone keys and labels", () => {
    expect(isPhoneLikeDispositionField("whatsapp_number")).toBe(true);
    expect(isPhoneLikeDispositionField("wa_number")).toBe(true);
    expect(isPhoneLikeDispositionField("contact", "WhatsApp number")).toBe(true);
    expect(isPhoneLikeDispositionField("outcome")).toBe(false);
  });
});

describe("extractBarePhone", () => {
  it("strips prose around a WhatsApp number", () => {
    expect(
      extractBarePhone("The caller shared their WhatsApp number as 9876543210 for the brochure."),
    ).toBe("9876543210");
  });

  it("keeps clean digits and country code", () => {
    expect(extractBarePhone("9876543210")).toBe("9876543210");
    expect(extractBarePhone("+91 98765 43210")).toBe("919876543210");
  });

  it("returns null when no phone present", () => {
    expect(extractBarePhone("Interested in Fortune Towers expo")).toBeNull();
  });
});

describe("clampDispositionText", () => {
  it("keeps only the first sentence", () => {
    expect(clampDispositionText("Interested in booth. Also asked about pricing and dates later.")).toBe(
      "Interested in booth.",
    );
  });
});

describe("normalizeDispositionSchemaResult", () => {
  it("normalizes whatsapp field to digits only", () => {
    const schema = [
      { key: "whatsapp_number", label: "WhatsApp", type: "text" },
      { key: "outcome", label: "Outcome", type: "choice", options: ["interested", "callback"] },
    ];
    const out = normalizeDispositionSchemaResult(schema, {
      whatsapp_number: "Please note WhatsApp is 8428920212 thanks",
      outcome: "interested",
    });
    expect(out["whatsapp_number"]).toBe("8428920212");
    expect(out["outcome"]).toBe("interested");
  });
});

describe("formatDispositionFieldList", () => {
  it("marks phone fields as digits-only", () => {
    const list = formatDispositionFieldList([
      { key: "whatsapp_number", label: "WA", type: "text" },
    ]);
    expect(list).toContain("digits only");
  });
});

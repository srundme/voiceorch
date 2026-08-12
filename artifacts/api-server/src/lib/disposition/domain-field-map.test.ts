import { describe, expect, it } from "vitest";
import { buildPrompt } from "./buildPrompt.js";
import {
  fromStoredDomainField,
  slugDispositionKey,
  toStoredDomainField,
  uiTypeFromStored,
  OUTCOME_PRESETS,
} from "./domain-field-map.js";
import type { DispositionConfig } from "./types.js";

describe("slugDispositionKey", () => {
  it("slugifies labels", () => {
    expect(slugDispositionKey("WhatsApp number")).toBe("whatsapp_number");
    expect(slugDispositionKey("  City / Town ")).toBe("city_town");
  });
});

describe("toStoredDomainField", () => {
  it("maps phone to string with phone-like key", () => {
    const stored = toStoredDomainField({
      id: "1",
      label: "WhatsApp number",
      key: "whatsapp_number",
      uiType: "phone",
    });
    expect(stored).toEqual({
      key: "whatsapp_number",
      type: "string",
      label: "WhatsApp number",
    });
  });

  it("prefixes non-phone keys when uiType is phone", () => {
    const stored = toStoredDomainField({
      id: "1",
      label: "Alt contact",
      key: "alt_contact",
      uiType: "phone",
    });
    expect(stored?.key).toBe("whatsapp_alt_contact");
    expect(stored?.type).toBe("string");
  });

  it("maps yes_no to boolean and choice to enum", () => {
    expect(
      toStoredDomainField({
        id: "1",
        label: "Consent",
        key: "consent",
        uiType: "yes_no",
      }),
    ).toMatchObject({ type: "boolean", label: "Consent" });

    expect(
      toStoredDomainField({
        id: "1",
        label: "Budget",
        key: "budget",
        uiType: "choice",
        optionsText: "low, mid, high",
      }),
    ).toEqual({
      key: "budget",
      type: "string",
      label: "Budget",
      enum: ["low", "mid", "high"],
    });
  });
});

describe("uiTypeFromStored / fromStoredDomainField", () => {
  it("round-trips phone and choice", () => {
    expect(uiTypeFromStored({ key: "whatsapp_number", type: "string", label: "WA" })).toBe("phone");
    const ui = fromStoredDomainField(
      { key: "budget", type: "string", label: "Budget", enum: ["low", "high"] },
      "fixed-id",
    );
    expect(ui.uiType).toBe("choice");
    expect(ui.optionsText).toBe("low, high");
    expect(ui.id).toBe("fixed-id");
  });
});

describe("buildPrompt labels", () => {
  it("includes domain field labels and phone digit hint", () => {
    const cfg: DispositionConfig = {
      agentId: 1,
      taxonomy: { outcome: ["interested", "callback"] },
      domainFields: [
        { key: "whatsapp_number", type: "string", label: "WhatsApp number" },
        { key: "city", type: "string", label: "City" },
      ],
      rules: [],
    };
    const prompt = buildPrompt(cfg, new Date("2026-08-06T10:00:00Z"));
    expect(prompt).toContain('whatsapp_number "WhatsApp number"');
    expect(prompt).toMatch(/digits only/i);
    expect(prompt).toContain('city "City"');
    expect(prompt).toContain("NEVER a paragraph");
  });
});

describe("OUTCOME_PRESETS", () => {
  it("has sales / support / lead_qual", () => {
    expect(OUTCOME_PRESETS.map((p) => p.id).sort()).toEqual(["lead_qual", "sales", "support"]);
    expect(OUTCOME_PRESETS.find((p) => p.id === "sales")!.taxonomy.outcome).toContain("interested");
  });
});

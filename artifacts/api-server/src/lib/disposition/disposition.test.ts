import { describe, it, expect } from "vitest";
import { buildSchema } from "./buildSchema.js";
import { buildPrompt } from "./buildPrompt.js";
import { rulePrefilter } from "./rulePrefilter.js";
import { validate } from "./validate.js";
import type { DispositionConfig, CallEvent } from "./types.js";

const INSURANCE_TAXONOMY = {
  SALE_CLOSED:    ["payment_link_sent", "policy_issued"],
  INTERESTED:     ["wants_callback", "needs_quote", "comparing"],
  NOT_INTERESTED: ["has_existing_policy", "price_objection", "no_need"],
  CALLBACK:       ["busy_now", "decision_maker_absent"],
  DNC:            ["opt_out", "abusive"],
  NOT_CONNECTED:  ["voicemail", "no_answer", "wrong_number", "language_barrier"],
};

const cfg: DispositionConfig = {
  agentId: 1,
  taxonomy: INSURANCE_TAXONOMY,
  domainFields: [],
  rules: [],
};

const cfgWithDomain: DispositionConfig = {
  ...cfg,
  domainFields: [
    { key: "product_type", type: "string", enum: ["term", "health", "motor"] },
    { key: "premium_quoted", type: "number" },
    { key: "consent_given", type: "boolean" },
  ],
};

// ── buildSchema ───────────────────────────────────────────────────────────────

describe("buildSchema", () => {
  it("produces required fields", () => {
    const schema = buildSchema(cfg) as any;
    expect(schema.required).toContain("primary");
    expect(schema.required).toContain("sub");
    expect(schema.required).toContain("confidence");
    expect(schema.required).toContain("evidence");
    expect(schema.required).toContain("summary");
  });

  it("primary enum contains all taxonomy keys", () => {
    const schema = buildSchema(cfg) as any;
    const primaryEnum: string[] = schema.properties.primary.enum;
    expect(primaryEnum).toContain("SALE_CLOSED");
    expect(primaryEnum).toContain("NOT_CONNECTED");
    expect(primaryEnum).toContain("DNC");
  });

  it("sub enum contains all subs", () => {
    const schema = buildSchema(cfg) as any;
    const subEnum: string[] = schema.properties.sub.enum;
    expect(subEnum).toContain("voicemail");
    expect(subEnum).toContain("payment_link_sent");
    expect(subEnum).toContain("abusive");
  });

  it("adds domain fields with correct types", () => {
    const schema = buildSchema(cfgWithDomain) as any;
    expect(schema.properties.product_type.enum).toContain("term");
    expect(schema.properties.product_type.enum).toContain(null);
    expect(schema.properties.premium_quoted.type).toContain("number");
    expect(schema.properties.consent_given.type).toContain("boolean");
  });

  it("sets additionalProperties false", () => {
    const schema = buildSchema(cfg) as any;
    expect(schema.additionalProperties).toBe(false);
  });
});

// ── buildPrompt ───────────────────────────────────────────────────────────────

describe("buildPrompt", () => {
  it("includes the taxonomy JSON", () => {
    const prompt = buildPrompt(cfg);
    expect(prompt).toContain("SALE_CLOSED");
    expect(prompt).toContain("payment_link_sent");
    expect(prompt).toContain("NOT_CONNECTED");
  });

  it("mentions customer intent, not agent", () => {
    const prompt = buildPrompt(cfg);
    expect(prompt.toLowerCase()).toContain("customer");
  });

  it("mentions multilingual support", () => {
    const prompt = buildPrompt(cfg);
    expect(prompt).toContain("Hindi");
    expect(prompt).toContain("Hinglish");
    expect(prompt).toContain("Kannada");
  });

  it("includes domain field instructions when present", () => {
    const prompt = buildPrompt(cfgWithDomain);
    expect(prompt).toContain("product_type");
    expect(prompt).toContain("premium_quoted");
    expect(prompt).toContain("consent_given");
  });

  it("does not include domain instructions when empty", () => {
    const prompt = buildPrompt(cfg);
    expect(prompt).not.toContain("domain-specific");
  });
});

// ── rulePrefilter ─────────────────────────────────────────────────────────────

describe("rulePrefilter", () => {
  it("returns null when no events fire a rule", () => {
    const events: CallEvent[] = [{ type: "transcript", text: "Hello" }];
    expect(rulePrefilter(events, [])).toBeNull();
  });

  it("detects voicemail via AMD event → NOT_CONNECTED/voicemail .99", () => {
    const events: CallEvent[] = [{ type: "amd", result: "machine" }];
    const result = rulePrefilter(events, []);
    expect(result).not.toBeNull();
    expect(result!.primary).toBe("NOT_CONNECTED");
    expect(result!.sub).toBe("voicemail");
    expect(result!.confidence).toBe(0.99);
  });

  it("detects voicemail_detected event", () => {
    const events: CallEvent[] = [{ type: "voicemail_detected" }];
    const result = rulePrefilter(events, []);
    expect(result!.sub).toBe("voicemail");
  });

  it("detects short duration → NOT_CONNECTED/no_answer .95", () => {
    const events: CallEvent[] = [{ type: "call_stats", durationSec: 4 }];
    const result = rulePrefilter(events, []);
    expect(result!.primary).toBe("NOT_CONNECTED");
    expect(result!.sub).toBe("no_answer");
    expect(result!.confidence).toBe(0.95);
  });

  it("detects low user speech → no_answer", () => {
    const events: CallEvent[] = [{ type: "call_stats", durationSec: 60, userSpeechSec: 0.5 }];
    const result = rulePrefilter(events, []);
    expect(result!.sub).toBe("no_answer");
  });

  it("detects DTMF 9 → DNC/opt_out .99", () => {
    const events: CallEvent[] = [{ type: "dtmf", digit: "9" }];
    const result = rulePrefilter(events, []);
    expect(result!.primary).toBe("DNC");
    expect(result!.sub).toBe("opt_out");
    expect(result!.confidence).toBe(0.99);
  });

  it("applies tenant rules after platform rules", () => {
    const events: CallEvent[] = [{ type: "call_stats", durationSec: 120, userSpeechSec: 10 }];
    const tenantRules = [
      { when: "event_type_present", value: "wrong_number_signal", primary: "NOT_CONNECTED", sub: "wrong_number", confidence: 0.9 },
    ];
    expect(rulePrefilter(events, tenantRules)).toBeNull(); // event not present
  });

  it("tenant rule fires when event_type_present matches", () => {
    const events: CallEvent[] = [
      { type: "call_stats", durationSec: 90, userSpeechSec: 5 },
      { type: "wrong_number_signal" },
    ];
    const tenantRules = [
      { when: "event_type_present", value: "wrong_number_signal", primary: "NOT_CONNECTED", sub: "wrong_number", confidence: 0.9 },
    ];
    const result = rulePrefilter(events, tenantRules);
    expect(result!.sub).toBe("wrong_number");
  });
});

// ── validate ──────────────────────────────────────────────────────────────────

describe("validate", () => {
  it("passes valid output unchanged (above confidence threshold)", () => {
    const out = { primary: "INTERESTED", sub: "needs_quote", confidence: 0.9, evidence: "I want a quote", summary: "Interested in quote" };
    const result = validate(cfg, out, []);
    expect(result.primary).toBe("INTERESTED");
    expect(result.sub).toBe("needs_quote");
    expect(result.confidence).toBe(0.9);
    expect(result.needsReview).toBe(false);
    expect(result.flags).toHaveLength(0);
  });

  it("snaps invalid sub to first valid sub and caps confidence at 0.5", () => {
    const out = { primary: "INTERESTED", sub: "voicemail", confidence: 0.85, evidence: "e", summary: "s" };
    const result = validate(cfg, out, []);
    expect(result.sub).toBe("wants_callback"); // first valid sub for INTERESTED
    expect(result.confidence).toBeLessThanOrEqual(0.5);
    expect(result.needsReview).toBe(true);
  });

  it("flags SALE_CLOSED on short call (<60s)", () => {
    const out = { primary: "SALE_CLOSED", sub: "payment_link_sent", confidence: 0.95, evidence: "Yes I'll pay", summary: "Sale" };
    const events: CallEvent[] = [{ type: "call_stats", durationSec: 30 }];
    const result = validate(cfg, out, events);
    expect(result.flags).toContain("sale_but_short_call");
    expect(result.needsReview).toBe(true);
  });

  it("does NOT flag SALE_CLOSED on long call (>=60s)", () => {
    const out = { primary: "SALE_CLOSED", sub: "payment_link_sent", confidence: 0.95, evidence: "e", summary: "s" };
    const events: CallEvent[] = [{ type: "call_stats", durationSec: 90 }];
    const result = validate(cfg, out, events);
    expect(result.flags).not.toContain("sale_but_short_call");
  });

  it("flags CALLBACK without consent", () => {
    const out = { primary: "CALLBACK", sub: "busy_now", confidence: 0.8, evidence: "call me later", summary: "Callback" };
    const result = validate(cfg, out, []);
    expect(result.flags).toContain("callback_without_consent");
    expect(result.needsReview).toBe(true);
  });

  it("does NOT flag CALLBACK when consent given", () => {
    const out = { primary: "CALLBACK", sub: "busy_now", confidence: 0.8, evidence: "e", summary: "s" };
    const events: CallEvent[] = [{ type: "consent", given: true }];
    const result = validate(cfg, out, events);
    expect(result.flags).not.toContain("callback_without_consent");
  });

  it("needsReview when confidence < 0.7", () => {
    const out = { primary: "NOT_INTERESTED", sub: "no_need", confidence: 0.6, evidence: "e", summary: "s" };
    const result = validate(cfg, out, []);
    expect(result.needsReview).toBe(true);
  });
});

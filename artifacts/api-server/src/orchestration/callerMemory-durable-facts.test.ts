import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  callerProfilesTable: {},
  scheduledCallbacksTable: {},
  callerFactsTable: {},
  callerCallArchiveTable: {},
  callerSentencesTable: {},
  callerFactSentenceLinksTable: {},
  callerEpisodeFactLinksTable: {},
  pendingCallerFactsTable: {},
  canonicalizeCallerKey: (p: string) => p,
  isRealPhoneNumber: () => true,
  humanPhone: (p: string) => p,
  resolveCallerKey: (_d: string, f: string) => f,
}));

import {
  canonicalizeFactKey,
  isDurableFactKey,
  normalizeDurableFact,
  normalizeFactValue,
  validateFactCandidate,
} from "./callerMemory-durable-facts.js";
import {
  speakerTurns,
  formatSpeakerTranscript,
  pickImportantCallerLines,
  buildFallbackEpisodeSummary,
} from "./callerMemory.js";
import type { ConversationTurn } from "./types.js";

describe("durable fact keys", () => {
  it("maps synonyms onto canonical durable keys", () => {
    expect(canonicalizeFactKey("full_name")).toBe("name");
    expect(canonicalizeFactKey("Hometown")).toBe("location");
    expect(canonicalizeFactKey("native_place")).toBe("location");
    expect(canonicalizeFactKey("kids_count")).toBe("family_children_count");
    expect(canonicalizeFactKey("spouse_name")).toBe("family_spouse_name");
    expect(canonicalizeFactKey("employer")).toBe("company_name");
    expect(canonicalizeFactKey("policy_name")).toBe("existing_product");
    expect(canonicalizeFactKey("existing_policy")).toBe("existing_product");
    expect(canonicalizeFactKey("dob")).toBe("date_of_birth");
    expect(canonicalizeFactKey("mobile_number")).toBe("phone_number");
    expect(canonicalizeFactKey("wtsp")).toBe("whatsapp_number");
  });

  it("rejects ephemeral / sales keys", () => {
    expect(canonicalizeFactKey("budget_range")).toBeNull();
    expect(canonicalizeFactKey("interested_in")).toBeNull();
    expect(canonicalizeFactKey("desired_coverage")).toBeNull();
    expect(canonicalizeFactKey("follow_up_needed")).toBeNull();
    expect(canonicalizeFactKey("concerns")).toBeNull();
    expect(canonicalizeFactKey("family_members")).toBeNull();
  });

  it("normalizeDurableFact drops low confidence and product-as-name", () => {
    expect(
      normalizeDurableFact({ key: "location", value: "Chennai", confidence: 0.95 }),
    ).toMatchObject({ key: "location", value: "Chennai", confidence: 0.95 });

    expect(
      normalizeDurableFact({ key: "budget", value: "5000", confidence: 0.99 }),
    ).toBeNull();

    expect(
      normalizeDurableFact({ key: "name", value: "managed plan", confidence: 0.95 }),
    ).toBeNull();

    expect(
      normalizeDurableFact({ key: "age", value: "42", confidence: 0.5 }),
    ).toBeNull();
  });

  it("normalizes city aliases and emails", () => {
    expect(normalizeFactValue("location", "Bangalore")).toBe("Bengaluru");
    expect(normalizeFactValue("email", "A@B.Co")).toBe("a@b.co");
    expect(normalizeFactValue("email", "vandhukarthikeyan@gmail.com")).toBe("karthikeyan@gmail.com");
  });

  it("normalizes existing_product and rejects generic labels", () => {
    expect(normalizeFactValue("existing_product", "Galaxy Marvel")).toBe("Galaxy Marvel");
    expect(normalizeFactValue("existing_product", "policy")).toBeNull();
  });

  it("normalizes DOB, phone, WhatsApp, and spoken email", () => {
    expect(normalizeFactValue("date_of_birth", "15 January 1990")).toBe("1990-01-15");
    expect(normalizeFactValue("date_of_birth", "15/01/1990")).toBe("1990-01-15");
    expect(normalizeFactValue("date_of_birth", "32")).toBeNull();
    expect(normalizeFactValue("phone_number", "9876543210")).toBe("+919876543210");
    expect(normalizeFactValue("phone_number", "nine eight seven six five four three two one zero"))
      .toBe("+919876543210");
    expect(normalizeFactValue("whatsapp_number", "98765 43210")).toBe("+919876543210");
    expect(normalizeFactValue("phone_number", "12345")).toBeNull();
    expect(normalizeFactValue("email", "karthi at gmail dot com")).toBe("karthi@gmail.com");
  });

  it("validation gate requires caller citations", () => {
    const callerIds = new Set([10]);
    expect(validateFactCandidate({
      key: "location",
      value: "Chennai",
      confidence: 0.9,
      sentenceIds: [10],
      callerSentenceIds: callerIds,
      requireCitation: true,
    }).ok).toBe(true);

    expect(validateFactCandidate({
      key: "location",
      value: "Chennai",
      confidence: 0.9,
      sentenceIds: [99],
      callerSentenceIds: callerIds,
      requireCitation: true,
    }).reason).toBe("agent_attribution");

    expect(validateFactCandidate({
      key: "location",
      value: "Chennai",
      confidence: 0.9,
      sentenceIds: [],
      callerSentenceIds: callerIds,
      requireCitation: true,
    }).reason).toBe("missing_citation");
  });

  it("isDurableFactKey only accepts allowlist", () => {
    expect(isDurableFactKey("name")).toBe(true);
    expect(isDurableFactKey("family_children_count")).toBe(true);
    expect(isDurableFactKey("existing_product")).toBe(true);
    expect(isDurableFactKey("date_of_birth")).toBe(true);
    expect(isDurableFactKey("phone_number")).toBe(true);
    expect(isDurableFactKey("whatsapp_number")).toBe(true);
    expect(isDurableFactKey("family_members")).toBe(false);
    expect(isDurableFactKey("budget_range")).toBe(false);
  });
});

describe("speakerTurns / formatSpeakerTranscript", () => {
  it("drops tool roles and tool-result echoes", () => {
    const history: ConversationTurn[] = [
      { role: "assistant", content: "Hi, how can I help?" },
      { role: "user", content: "My name is Priya and I live in Madurai" },
      { role: "tool", content: '{"slots":[]}', toolName: "check_availability" },
      { role: "assistant", content: "[Tool result for check_availability]: ok" },
      { role: "assistant", content: "Nice to meet you Priya" },
    ];
    const speech = speakerTurns(history);
    expect(speech.map((t) => t.role)).toEqual(["assistant", "user", "assistant"]);
    expect(formatSpeakerTranscript(history)).not.toContain("slots");
    expect(formatSpeakerTranscript(history)).toContain("Caller: My name is Priya");
  });
});

describe("episode fallback from important caller lines", () => {
  it("keeps identity/need lines and drops yes/ok filler", () => {
    const lines = pickImportantCallerLines([
      { speaker: "agent", text: "Hi, this is Gala Fit" },
      { speaker: "caller", text: "ok" },
      { speaker: "caller", text: "enoda peru Karthi, rajeswari ella" },
      { speaker: "caller", text: "naan professor-a irukken" },
    ]);
    expect(lines.some((l) => /Karthi/i.test(l))).toBe(true);
    expect(lines.some((l) => /professor/i.test(l))).toBe(true);
    expect(lines.some((l) => /^ok$/i.test(l))).toBe(false);
  });

  it("writes facts plus caller highlights onto the episode card", () => {
    const summary = buildFallbackEpisodeSummary({
      name: "Karthi",
      facts: [
        { key: "occupation", value: "professor" },
        { key: "existing_product", value: "Galaxy Marvel" },
      ],
      callerHighlights: ["enoda peru Karthi, rajeswari ella"],
    });
    expect(summary).toMatch(/Karthi/);
    expect(summary).toMatch(/professor/i);
    expect(summary).toMatch(/Galaxy Marvel/);
    expect(summary).toMatch(/Caller said:/);
  });
});

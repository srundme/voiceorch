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

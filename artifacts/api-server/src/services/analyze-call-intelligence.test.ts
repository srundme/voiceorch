import { describe, expect, it } from "vitest";
import { normalizeIntelligence } from "./call-intelligence-normalize.js";

describe("normalizeIntelligence", () => {
  it("keeps valid sentiment and intent", () => {
    const r = normalizeIntelligence({
      sentiment: "positive",
      detectedIntent: "interested",
      keyTopics: ["pricing", "demo"],
      summary: "Caller wants a demo next week.",
    });
    expect(r.sentiment).toBe("positive");
    expect(r.detectedIntent).toBe("interested");
    expect(r.keyTopics).toEqual(["pricing", "demo"]);
    expect(r.summary).toContain("demo");
  });

  it("falls back on unknown values", () => {
    const r = normalizeIntelligence({
      sentiment: "ecstatic",
      detectedIntent: "maybe later",
      keyTopics: "not-an-array",
    }, "fallback summary");
    expect(r.sentiment).toBe("neutral");
    expect(r.detectedIntent).toBe("no_decision");
    expect(r.keyTopics).toEqual([]);
    expect(r.summary).toBe("fallback summary");
  });

  it("normalises spaced intent strings and caps topics", () => {
    const r = normalizeIntelligence({
      sentiment: "NEGATIVE",
      intent: "callback requested",
      topics: ["a", "b", "c", "d", "e", "f", "g", "h"],
    });
    expect(r.sentiment).toBe("negative");
    expect(r.detectedIntent).toBe("callback_requested");
    expect(r.keyTopics).toHaveLength(6);
  });

  it("normalises deep purchase / emotion / agent scores", () => {
    const r = normalizeIntelligence({
      sentiment: "positive",
      detectedIntent: "interested",
      keyTopics: ["pricing"],
      purchaseIntentScore: 88,
      urgency: "high",
      objections: ["too expensive", "need to think"],
      buyingSignals: ["asked for invoice"],
      nextBestAction: "Send pricing PDF today",
      emotion: "enthusiastic",
      agentPerformance: {
        talkListenBalance: 4,
        empathy: 5,
        objectionHandling: 3,
        scriptAdherence: 4,
        clarity: 5,
        notes: "Good close",
      },
    });
    expect(r.purchaseIntentScore).toBe(88);
    expect(r.urgency).toBe("high");
    expect(r.objections).toHaveLength(2);
    expect(r.buyingSignals).toEqual(["asked for invoice"]);
    expect(r.emotion).toBe("enthusiastic");
    expect(r.agentPerformance?.empathy).toBe(5);
    expect(r.nextBestAction).toContain("pricing");
  });
});

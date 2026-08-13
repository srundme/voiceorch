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
});

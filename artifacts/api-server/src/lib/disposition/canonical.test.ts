import { describe, expect, it } from "vitest";
import {
  canonicalDispositionBucket,
  canonicalDispositionFromLabel,
  normalizeDispositionToken,
} from "./canonical.js";

describe("normalizeDispositionToken", () => {
  it("lowercases and unifies separators", () => {
    expect(normalizeDispositionToken("NOT_CONNECTED")).toBe("not connected");
    expect(normalizeDispositionToken("Not-Interested")).toBe("not interested");
    expect(normalizeDispositionToken("  no   pickup ")).toBe("no pickup");
  });
});

describe("canonicalDispositionBucket", () => {
  it("uses the sub when the primary is a generic container", () => {
    expect(canonicalDispositionBucket("outcome", "not interested")).toBe("not interested");
    expect(canonicalDispositionBucket("outcome", "busy")).toBe("busy");
  });

  it("keeps the primary when it carries the meaning", () => {
    expect(canonicalDispositionBucket("interested", "interested")).toBe("interested");
  });

  it("falls back to the primary when there is no sub", () => {
    expect(canonicalDispositionBucket("outcome", "")).toBe("outcome");
  });

  it("returns empty for empty input", () => {
    expect(canonicalDispositionBucket("", "")).toBe("");
  });
});

describe("canonicalDispositionFromLabel", () => {
  // These are the labels that produced eight KPI cards for four real outcomes.
  it("collapses every spelling of an unanswered call", () => {
    const unanswered = [
      "NOT_CONNECTED: no_answer",
      "no pickup: no pickup",
      "not pickup: no pickup",
      "outcome: no_answer",
      "outcome: not connected",
    ];
    for (const label of unanswered) {
      expect(canonicalDispositionFromLabel(label)).toBe("no pickup");
    }
  });

  it("collapses a sub that was also promoted to a category", () => {
    expect(canonicalDispositionFromLabel("outcome: not interested")).toBe("not interested");
    expect(canonicalDispositionFromLabel("not interested: not interested")).toBe("not interested");
  });

  it("keeps genuinely different outcomes apart", () => {
    const buckets = [
      "outcome: interested",
      "outcome: not interested",
      "outcome: busy",
      "outcome: callback requested",
      "outcome: phone number purchased",
    ].map(canonicalDispositionFromLabel);

    expect(new Set(buckets).size).toBe(buckets.length);
  });

  it("handles labels with no sub", () => {
    expect(canonicalDispositionFromLabel("interested")).toBe("interested");
    expect(canonicalDispositionFromLabel("")).toBe("");
  });
});

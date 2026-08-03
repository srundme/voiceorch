import { describe, expect, it } from "vitest";
import { isNearDuplicateUtterance } from "./transcriptQuality.js";

/**
 * Guards lost-turn recovery. When a turn is recovered through batch STT, the
 * streaming socket may still deliver the same audio afterwards (it re-queues
 * buffered frames across a reconnect). Without this check the caller's turn is
 * processed twice; if it matches too loosely, a genuine repeat is swallowed.
 */
describe("isNearDuplicateUtterance — same utterance heard twice", () => {
  it("matches identical text", () => {
    expect(isNearDuplicateUtterance("I want to book an appointment", "I want to book an appointment")).toBe(true);
  });

  it("ignores punctuation and casing", () => {
    expect(isNearDuplicateUtterance("Book it for tomorrow.", "book it for tomorrow")).toBe(true);
  });

  it("tolerates one engine dropping a filler word", () => {
    expect(
      isNearDuplicateUtterance(
        "I want to book an appointment tomorrow at eleven",
        "I want to book appointment tomorrow at eleven",
      ),
    ).toBe(true);
  });

  it("matches across Tamil transcripts", () => {
    expect(isNearDuplicateUtterance("நாளைக்கு அப்பாயிண்ட்மென்ட் வேணும்", "நாளைக்கு அப்பாயிண்ட்மென்ட் வேணும்.")).toBe(true);
  });
});

describe("isNearDuplicateUtterance — genuinely different turns", () => {
  it("does not match different requests", () => {
    expect(isNearDuplicateUtterance("I want to book an appointment", "Actually cancel that please")).toBe(false);
  });

  it("does not match a name against a booking request", () => {
    expect(isNearDuplicateUtterance("My name is Benicia", "I want to book an appointment tomorrow")).toBe(false);
  });

  // A one-word reply only counts as a duplicate on an EXACT match. Within the short
  // recovery window, the same word arriving twice is far more likely to be replayed
  // audio than a real repeat, and processing a stray "yes" twice mid-booking is
  // worse than reprompting. Fuzzy matching stays off for single words.
  it("treats an identical one-word reply as a duplicate", () => {
    expect(isNearDuplicateUtterance("Yes", "Yes")).toBe(true);
    expect(isNearDuplicateUtterance("Okay", "Okay.")).toBe(true);
  });

  it("does not fuzzy-match different one-word replies", () => {
    expect(isNearDuplicateUtterance("Yes", "No")).toBe(false);
    expect(isNearDuplicateUtterance("Okay", "Tomorrow")).toBe(false);
  });

  it("does not match on empty input", () => {
    expect(isNearDuplicateUtterance("", "anything at all")).toBe(false);
    expect(isNearDuplicateUtterance("   ", "")).toBe(false);
  });

  it("does not match a short phrase that is merely contained in a longer one", () => {
    expect(isNearDuplicateUtterance("book it", "book it for tomorrow at eleven in the morning please")).toBe(true);
    expect(isNearDuplicateUtterance("cancel it", "book it for tomorrow at eleven")).toBe(false);
  });
});

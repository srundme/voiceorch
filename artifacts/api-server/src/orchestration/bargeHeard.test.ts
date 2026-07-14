import { describe, expect, it } from "vitest";
import {
  buildInterruptionHint,
  composeHeardWithMid,
  estimateHeardPrefix,
  joinHeardSentences,
  resolveSpokenForHistory,
} from "./bargeHeard.js";

describe("joinHeardSentences", () => {
  it("joins completed sentences and drops empties", () => {
    expect(joinHeardSentences(["Hello.", " How are you? ", ""])).toBe("Hello. How are you?");
    expect(joinHeardSentences([])).toBe("");
  });
});

describe("estimateHeardPrefix", () => {
  it("returns empty before any ms elapses", () => {
    expect(estimateHeardPrefix("Hello there friend", 0)).toBe("");
  });

  it("returns a word-bounded prefix from elapsed ms", () => {
    // 70ms/char → ~7 chars ≈ "Hello t" → cut at "Hello"
    const prefix = estimateHeardPrefix("Hello there friend", 70 * 7);
    expect(prefix).toBe("Hello");
  });

  it("returns full text when elapsed covers the sentence", () => {
    const t = "Short ok.";
    expect(estimateHeardPrefix(t, 70 * t.length + 100)).toBe(t);
  });
});

describe("composeHeardWithMid", () => {
  it("merges completed and mid prefix", () => {
    expect(composeHeardWithMid("First.", "Second half")).toBe("First. Second half");
    expect(composeHeardWithMid("", "Only mid")).toBe("Only mid");
  });
});

describe("buildInterruptionHint", () => {
  it("prefers concrete heard text", () => {
    expect(buildInterruptionHint("First sentence. Second", true)).toBe("First sentence. Second");
    expect(buildInterruptionHint("", true)).toBe(
      "(interrupted before a full sentence finished)",
    );
  });
});

describe("resolveSpokenForHistory", () => {
  it("on barge stores heard only — never the full unspoken LLM tail", () => {
    expect(
      resolveSpokenForHistory({
        barged: true,
        heardOnly: "Hello.",
        fullResponse: "Hello. Long unspoken pitch about insurance.",
      }),
    ).toBe("Hello.");
    expect(
      resolveSpokenForHistory({
        barged: true,
        heardOnly: "",
        fullResponse: "You never heard this.",
      }),
    ).toBe("");
  });

  it("when not barged prefers played sentences over blind full response", () => {
    expect(
      resolveSpokenForHistory({
        barged: false,
        heardOnly: "Only this played.",
        fullResponse: "Only this played. Plus a gated sentence.",
      }),
    ).toBe("Only this played.");
  });
});

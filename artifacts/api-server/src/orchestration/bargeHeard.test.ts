import { describe, expect, it } from "vitest";
import {
  buildInterruptionHint,
  joinHeardSentences,
  resolveSpokenForHistory,
} from "./bargeHeard.js";

describe("joinHeardSentences", () => {
  it("joins completed sentences and drops empties", () => {
    expect(joinHeardSentences(["Hello.", " How are you? ", ""])).toBe("Hello. How are you?");
    expect(joinHeardSentences([])).toBe("");
  });
});

describe("buildInterruptionHint", () => {
  it("never pastes unspoken mid-sentence body into the hint", () => {
    expect(buildInterruptionHint("First sentence.", true)).toBe(
      "First sentence. [cut mid-sentence]",
    );
    expect(buildInterruptionHint("First sentence.", false)).toBe("First sentence.");
    expect(buildInterruptionHint("", true)).toBe(
      "(interrupted before a full sentence finished)",
    );
    expect(buildInterruptionHint("", false)).toBe(
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
    expect(
      resolveSpokenForHistory({
        barged: false,
        heardOnly: "",
        fullResponse: "Fallback full text",
      }),
    ).toBe("Fallback full text");
  });
});

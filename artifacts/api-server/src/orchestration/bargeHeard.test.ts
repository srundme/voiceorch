import { describe, expect, it } from "vitest";
import {
  buildInterruptionHint,
  buildInterruptionInstruction,
  composeHeardWithMid,
  estimateHeardPrefix,
  joinHeardSentences,
  resolveSpokenForHistory,
} from "./bargeHeard.js";

describe("buildInterruptionInstruction", () => {
  it("hands the unheard part back so a cut intro is finished (call 43748)", () => {
    const s = buildInterruptionInstruction("நா பூஜா,", "Star Health Insurance சார்பா பேசுறேன்.");
    expect(s).toContain('heard only: "நா பூஜா,"');
    expect(s).toContain('did NOT hear: "Star Health Insurance சார்பா பேசுறேன்."');
    expect(s).toContain("say the part they did not hear now");
    expect(s).not.toMatch(/self-intro/);
  });

  it("falls back to answer-only guidance when nothing is left unheard", () => {
    const s = buildInterruptionInstruction("(interrupted before a full sentence finished)", null);
    expect(s).not.toContain("did NOT hear");
    expect(s).toContain("answer that in one new sentence");
  });
});

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
  it("never invents delivered speech when the carrier receipt is missing", () => {
    expect(resolveSpokenForHistory({
      requireDeliveryEvidence: true, barged: false, heardOnly: "", fullResponse: "Unconfirmed reply.",
    })).toBe("");
    expect(resolveSpokenForHistory({
      requireDeliveryEvidence: true, barged: false, heardOnly: "Confirmed.", fullResponse: "Confirmed. Unconfirmed.",
    })).toBe("Confirmed.");
  });
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

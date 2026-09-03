import { describe, expect, it } from "vitest";
import {
  extractSentences,
  isTinyLeadFragment,
  isUsableSpeakableClause,
  pickStreamedGreetingHead,
  tryEarlyPhraseDispatch,
} from "./clause-stream.js";

describe("tiny lead fragments", () => {
  it("coalesces Sorry / Hello / Okay instead of treating them as a reply", () => {
    expect(isTinyLeadFragment("Sorry,")).toBe(true);
    expect(isTinyLeadFragment("Hello")).toBe(true);
    expect(isTinyLeadFragment("Okay.")).toBe(true);
    expect(isTinyLeadFragment("Right.")).toBe(true);
    expect(isUsableSpeakableClause("Sorry,")).toBe(false);
  });

  it("treats a 4-word clause as usable", () => {
    expect(isUsableSpeakableClause("Sorry, the line cut out")).toBe(true);
    expect(isTinyLeadFragment("Sorry, the line cut out")).toBe(false);
  });
});

describe("clause-level dispatch", () => {
  it("does not emit Sorry as its own TTS job", () => {
    expect(tryEarlyPhraseDispatch("Sorry, the line cut out there", 8)?.clause)
      .not.toBe("Sorry");
    const { sentences, remainder } = extractSentences("Sorry, the line cut out there", 8);
    expect(sentences.some((s) => isTinyLeadFragment(s))).toBe(false);
    expect(sentences.join(" ") + remainder).toContain("Sorry");
  });

  it("starts synthesis on the first usable greeting clause", () => {
    expect(pickStreamedGreetingHead("Sorry,")).toBe("");
    expect(pickStreamedGreetingHead("Sorry, the line cut out")).toBe(
      "Sorry, the line cut out",
    );
  });
});

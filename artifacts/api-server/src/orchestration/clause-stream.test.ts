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

  it("Cartesia sentence mode splits on em-dash, not comma (call 21264)", () => {
    const pending =
      "I'd be happy to help, but just to clarify — earlier we were talking about a campus visit";
    const { sentences, remainder } = extractSentences(pending, 15, { earlyClause: false });
    expect(sentences[0]).toBe("I'd be happy to help, but just to clarify");
    expect(remainder).toMatch(/^earlier we were talking/);
  });

  it("Cartesia sentence mode keeps commas until .!?", () => {
    const pending = "Hello Gopi, I can help";
    const { sentences, remainder } = extractSentences(pending, 8, { earlyClause: false });
    expect(sentences).toEqual([]);
    expect(remainder).toBe(pending);
    expect(pickStreamedGreetingHead(pending, { earlyClause: false })).toBe("");
    expect(pickStreamedGreetingHead(
      "Sorry, the line cut out there for a second.",
      { earlyClause: false },
    )).toBe("Sorry, the line cut out there for a second.");
  });

  it("Cartesia does not word-split a long greeting (call 24502 glue)", () => {
    const pending = "Hello Gopi, I'm Aisha from ILCC and I can help you today with admissions";
    const { sentences, remainder } = extractSentences(pending, 8, { earlyClause: false });
    expect(sentences).toEqual([]);
    expect(remainder).toBe(pending);
  });
});

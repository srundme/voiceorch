import { describe, expect, it } from "vitest";
import {
  extractSentences,
  isTinyLeadFragment,
  isUsableSpeakableClause,
  pickStreamedGreetingHead,
  tryEarlyPhraseDispatch,
  ttsSentenceOptions,
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

describe("provider-aware sentence buffering", () => {
  it.each(["sarvam", "Sarvam", "cartesia", "irfan_pod"])("keeps %s mid-phrase Hindi tokens in one synthesis job", (provider) => {
    const opts = ttsSentenceOptions(provider);
    let pending = "";
    const spoken: string[] = [];
    for (const token of ["मैं SnapServe की तरफ से हूँ", " और मेरी ज़िम्मेदारी founders के लिए demos", " schedule करना है"]) {
      const result = extractSentences(pending + token, 5, opts);
      spoken.push(...result.sentences);
      pending = result.remainder;
      expect(spoken).toEqual([]);
    }
    const end = extractSentences(pending + "।", 5, opts);
    expect(end.sentences).toEqual([pending + "।"]);
    expect(end.remainder).toBe("");
  });

  it("does not split the booking hour from बजे", () => {
    const text = "तो बताइए, कल शनिवार 12 September को दोपहर 2 बजे या शाम 4 बजे कौन सा time आपके लिए सही रहेगा?";
    let pending = "";
    const spoken: string[] = [];
    for (const token of text) {
      const result = extractSentences(pending + token, 5, ttsSentenceOptions("sarvam"));
      spoken.push(...result.sentences);
      pending = result.remainder;
    }
    expect(spoken).toEqual([text]);
    expect(pending).toBe("");
  });

  it("recognizes Hindi greeting punctuation without waiting for the entire reply", () => {
    const greeting = "नमस्ते, मैं आपकी कैसे मदद कर सकता हूँ।";
    expect(pickStreamedGreetingHead(greeting + " आगे की बात", ttsSentenceOptions("sarvam"))).toBe(greeting);
    expect(ttsSentenceOptions("elevenlabs").earlyClause).toBe(true);
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

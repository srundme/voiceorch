import { describe, it, expect } from "vitest";
import { isRealEnglishUtterance, resolveAutoDetectLanguage } from "./language-filler-guard.js";

describe("isRealEnglishUtterance", () => {
  it("rejects short fillers regardless of content", () => {
    expect(isRealEnglishUtterance("okay")).toBe(false);
    expect(isRealEnglishUtterance("ok")).toBe(false);
    expect(isRealEnglishUtterance("oh okay")).toBe(false);
    expect(isRealEnglishUtterance("thank you")).toBe(false);
    expect(isRealEnglishUtterance("thanks")).toBe(false);
    expect(isRealEnglishUtterance("yes")).toBe(false);
    expect(isRealEnglishUtterance("no")).toBe(false);
    expect(isRealEnglishUtterance("hmm")).toBe(false);
    expect(isRealEnglishUtterance("right")).toBe(false);
    expect(isRealEnglishUtterance("correct")).toBe(false);
    expect(isRealEnglishUtterance("fine")).toBe(false);
    expect(isRealEnglishUtterance("done")).toBe(false);
    expect(isRealEnglishUtterance("haan ok")).toBe(false);
  });

  it("rejects 3+ word utterances made entirely of filler words", () => {
    expect(isRealEnglishUtterance("okay thank you")).toBe(false);
    expect(isRealEnglishUtterance("thank you so much")).toBe(false);
    expect(isRealEnglishUtterance("yes yes correct")).toBe(false);
    expect(isRealEnglishUtterance("ok thank you bye")).toBe(false);
    expect(isRealEnglishUtterance("Oh okay, thank you!")).toBe(false);
  });

  it("accepts a real English sentence", () => {
    expect(isRealEnglishUtterance("how much does the premium cost?")).toBe(true);
    expect(isRealEnglishUtterance("what is the monthly insurance premium cost")).toBe(true);
    expect(isRealEnglishUtterance("I want to know about the policy")).toBe(true);
  });

  it("rejects a 2-word non-filler fragment (below minimum word count)", () => {
    expect(isRealEnglishUtterance("premium cost")).toBe(false);
  });

  it("handles punctuation and apostrophes", () => {
    expect(isRealEnglishUtterance("Okay... thank you!!")).toBe(false);
    expect(isRealEnglishUtterance("what's the interest rate here")).toBe(true);
  });

  it("rejects empty/whitespace input", () => {
    expect(isRealEnglishUtterance("")).toBe(false);
    expect(isRealEnglishUtterance("   ")).toBe(false);
  });
  it("treats 'tell me I'm on the line' as real English, not a borrowed filler", () => {
    expect(isRealEnglishUtterance("Tell me, I'm on the line, tell me.")).toBe(true);
    expect(isRealEnglishUtterance("please tell me")).toBe(false);
    expect(isRealEnglishUtterance("tell me more")).toBe(false);
  });

  it("rejects romanized Indic go-ahead replies (Latin script, not English)", () => {
    expect(isRealEnglishUtterance("Aa boliye Ma'am")).toBe(false);
    expect(isRealEnglishUtterance("boliye")).toBe(false);
    expect(isRealEnglishUtterance("haan boliye")).toBe(false);
    expect(isRealEnglishUtterance("bolo na")).toBe(false);
  });
});

describe("resolveAutoDetectLanguage", () => {
  it("does not flip a Tamil agent to English on LID junk (call 26703)", () => {
    expect(resolveAutoDetectLanguage({
      detected: "en-IN",
      latchedLang: null,
      currentLang: "ta-IN",
      text: "All right",
      agentLang: "ta-IN",
    })).toEqual({ lang: "ta-IN", heldFiller: true });
    expect(resolveAutoDetectLanguage({
      detected: "en-IN",
      latchedLang: null,
      currentLang: "ta-IN",
      text: "I need ten crore, Madam.",
      agentLang: "ta-IN",
    })).toEqual({ lang: "ta-IN", heldFiller: true });
  });

  it("honors an explicit language latch", () => {
    expect(resolveAutoDetectLanguage({
      detected: "hi-IN",
      latchedLang: "ta-IN",
      currentLang: "ta-IN",
      text: "मुझे जानकारी चाहिए",
      agentLang: "ta-IN",
    })).toEqual({ lang: "ta-IN", heldFiller: false });
  });

  it("keeps current language when LID is missing", () => {
    expect(resolveAutoDetectLanguage({
      detected: null,
      latchedLang: null,
      currentLang: "ta-IN",
      text: "…",
      agentLang: "ta-IN",
    })).toEqual({ lang: "ta-IN", heldFiller: false });
  });
});

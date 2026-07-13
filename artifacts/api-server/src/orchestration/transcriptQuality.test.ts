import { describe, expect, it } from "vitest";
import { checkTranscriptQuality, pickClarificationPhrase, isLikelyIncompleteEnglishFragment, shouldHoldFragmentForCoalesce } from "./transcriptQuality.js";

describe("checkTranscriptQuality", () => {
  it("flags Sarvam phantom silence hallucinations", () => {
    expect(checkTranscriptQuality("Out of").isGarbled).toBe(true);
    expect(checkTranscriptQuality("thank you").reason).toBe("phantom-utterance");
  });

  it("flags Indic script when STT is configured for English", () => {
    const r = checkTranscriptQuality("નમસ્તે બોલો", { expectedLang: "en-IN" });
    expect(r.isGarbled).toBe(true);
    expect(r.reason).toBe("script-mismatch-en");
  });

  it("accepts normal English on en-IN", () => {
    expect(checkTranscriptQuality("I want to book an appointment", { expectedLang: "en-IN" }).isGarbled).toBe(false);
  });

  it("accepts Tamil on ta-IN", () => {
    expect(checkTranscriptQuality("எனக்கு ஒரு அப்பாயிண்ட்மெண்ட் வேணும்", { expectedLang: "ta-IN" }).isGarbled).toBe(false);
  });

  it("does not flag English question fragments ending in how/what", () => {
    expect(checkTranscriptQuality("I want to know how", { expectedLang: "en-IN" }).isGarbled).toBe(false);
    expect(checkTranscriptQuality("I want to know how", { expectedLang: "en-IN" }).reason).toBe("");
  });

  it("still flags short English dangling prepositions", () => {
    expect(checkTranscriptQuality("concerned about", { expectedLang: "en-IN" }).reason).toBe("truncated-dangling");
  });

  it("coalesces likely incomplete English fragments", () => {
    expect(shouldHoldFragmentForCoalesce("I want to know how", { expectedLang: "en-IN" })).toBe(true);
    expect(isLikelyIncompleteEnglishFragment("I want to know how")).toBe(true);
    expect(shouldHoldFragmentForCoalesce("I can benefit in health insurance.", { expectedLang: "en-IN" })).toBe(false);
  });
});

describe("pickClarificationPhrase", () => {
  it("returns Tamil phrases for ta-IN", () => {
    const phrase = pickClarificationPhrase("ta-IN");
    expect(phrase).toMatch(/மன்னிக்கவும்|தயவு/);
  });

  it("returns Hindi phrases for hi-IN", () => {
    const phrase = pickClarificationPhrase("hi-IN");
    expect(phrase).toMatch(/माफ|क्षमा/);
  });

  it("is stable per rotation key (per-call)", () => {
    const a = pickClarificationPhrase("en-IN", "call-2527");
    const b = pickClarificationPhrase("en-IN", "call-2527");
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(10);
  });
});

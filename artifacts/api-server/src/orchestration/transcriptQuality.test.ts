import { describe, expect, it } from "vitest";
import {
  checkTranscriptQuality,
  pickClarificationPhrase,
  isLikelyIncompleteEnglishFragment,
  shouldHoldFragmentForCoalesce,
  isUltraShortNoiseFragment,
  isCallerAudioDifficulty,
  isFalseInterruptionScrap,
  isTopicClarificationAsk,
} from "./transcriptQuality.js";
import { isAffirmationOnlyUtterance } from "./endpointing.js";

describe("checkTranscriptQuality", () => {
  it("flags Sarvam phantom silence hallucinations", () => {
    expect(checkTranscriptQuality("Out of").isGarbled).toBe(true);
    expect(checkTranscriptQuality("are you there").reason).toBe("phantom-utterance");
  });

  it("accepts normal greetings and short acks (not clarification bait)", () => {
    expect(checkTranscriptQuality("Hi", { expectedLang: "en-IN" }).isGarbled).toBe(false);
    expect(checkTranscriptQuality("Hello", { expectedLang: "en-IN" }).isGarbled).toBe(false);
    expect(checkTranscriptQuality("Hi Madam", { expectedLang: "en-IN" }).isGarbled).toBe(false);
    expect(checkTranscriptQuality("Okay.", { expectedLang: "en-IN" }).isGarbled).toBe(false);
    expect(checkTranscriptQuality("thank you", { expectedLang: "en-IN" }).isGarbled).toBe(false);
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

describe("isUltraShortNoiseFragment", () => {
  it("drops single Indic syllables and 1–2 token stubs", () => {
    expect(isUltraShortNoiseFragment("ஆ")).toBe(true);
    expect(isUltraShortNoiseFragment("call பண்ண")).toBe(true);
    expect(isUltraShortNoiseFragment("Madam இப்போ")).toBe(true);
  });

  it("keeps real acks, greetings, and fuller utterances", () => {
    expect(isUltraShortNoiseFragment("Okay Madam")).toBe(false);
    expect(isUltraShortNoiseFragment("Okay Okay.")).toBe(false);
    expect(isUltraShortNoiseFragment("Hello")).toBe(false);
    expect(isUltraShortNoiseFragment("சரி")).toBe(false);
    expect(isUltraShortNoiseFragment("ஆ Madam பேசலாம் சொல்லுங்க.")).toBe(false);
    expect(isUltraShortNoiseFragment("இல்ல Madam இப்பதான் தெரிஞ்சிருக்கு.")).toBe(false);
  });
});

describe("isCallerAudioDifficulty", () => {
  it("detects English and Tamil cannot-hear phrases", () => {
    expect(isCallerAudioDifficulty("I can't hear you")).toBe(true);
    expect(isCallerAudioDifficulty("கேக்கல")).toBe(true);
    expect(isCallerAudioDifficulty("hello madam")).toBe(false);
  });
});

describe("isFalseInterruptionScrap", () => {
  it("drops Bolna-style short scraps at or under the word threshold", () => {
    expect(isFalseInterruptionScrap("சொல்லுங்க", 3)).toBe(true);
    expect(isFalseInterruptionScrap("call பண்ண", 3)).toBe(true);
    expect(isFalseInterruptionScrap("wait wait wait wait", 3)).toBe(false);
  });

  it("keeps real acks and audio-difficulty reports", () => {
    expect(isFalseInterruptionScrap("okay", 3)).toBe(false);
    expect(isFalseInterruptionScrap("சரி", 3)).toBe(false);
    expect(isFalseInterruptionScrap("கேக்கல", 3)).toBe(false);
  });

  it("keeps topic-clarification asks even when short", () => {
    expect(isTopicClarificationAsk("about the Kala Fit")).toBe(true);
    expect(isFalseInterruptionScrap("about the Kala Fit", 3)).toBe(false);
  });
});

describe("isAffirmationOnlyUtterance", () => {
  it("treats okay okay / yes madam as affirmation-only", () => {
    expect(isAffirmationOnlyUtterance(["okay", "okay"])).toBe(true);
    expect(isAffirmationOnlyUtterance(["yes", "madam"])).toBe(true);
    expect(isAffirmationOnlyUtterance(["yes", "i", "have", "two", "minutes"])).toBe(false);
  });
});

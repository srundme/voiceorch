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
  isAccidentalInterruptPhrase,
  isBackchannelOnlyUtterance,
  normalizeSttPhonetics,
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

  it("accepts complete 'not yet' answers (call 4943 false clarification)", () => {
    expect(checkTranscriptQuality("No, not yet.", { expectedLang: "en-IN" }).isGarbled).toBe(false);
    expect(checkTranscriptQuality("No not yet", { expectedLang: "en-IN" }).isGarbled).toBe(false);
    expect(checkTranscriptQuality("not yet.", { expectedLang: "en-IN" }).isGarbled).toBe(false);
    expect(checkTranscriptQuality("No, not yet.", { expectedLang: "en-IN" }).reason).toBe("");
  });

  it("still flags short English dangling prepositions", () => {
    expect(checkTranscriptQuality("concerned about", { expectedLang: "en-IN" }).reason).toBe("truncated-dangling");
  });

  it("coalesces likely incomplete English fragments", () => {
    expect(shouldHoldFragmentForCoalesce("I want to know how", { expectedLang: "en-IN" })).toBe(true);
    expect(isLikelyIncompleteEnglishFragment("I want to know how")).toBe(true);
    expect(shouldHoldFragmentForCoalesce("I can benefit in health insurance.", { expectedLang: "en-IN" })).toBe(false);
  });

  it("coalesces pure Tamil/English backchannel acks (call 2967)", () => {
    expect(isBackchannelOnlyUtterance("சரி")).toBe(true);
    expect(isBackchannelOnlyUtterance("ஆமா")).toBe(true);
    expect(isBackchannelOnlyUtterance("okay")).toBe(true);
    expect(isBackchannelOnlyUtterance("okay sir")).toBe(true);
    expect(shouldHoldFragmentForCoalesce("சரி", { expectedLang: "ta-IN" })).toBe(true);
    expect(shouldHoldFragmentForCoalesce("ஆமா", { expectedLang: "ta-IN" })).toBe(true);
    expect(isBackchannelOnlyUtterance("இப்ப என்ன time சார்?")).toBe(false);
    expect(shouldHoldFragmentForCoalesce("இப்ப என்ன time சார்?", { expectedLang: "ta-IN" })).toBe(false);
    expect(isBackchannelOnlyUtterance("hello")).toBe(false);
  });

  it("holds Yes Ma'am so How are you can merge (call 4856 zigzag)", () => {
    expect(isBackchannelOnlyUtterance("Yes Ma'am")).toBe(true);
    expect(shouldHoldFragmentForCoalesce("Yes Ma'am", { expectedLang: "en-IN" })).toBe(true);
    expect(shouldHoldFragmentForCoalesce("How are you, Ma'am?", { expectedLang: "en-IN" })).toBe(false);
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
  it("drops only bare single-syllable stubs", () => {
    expect(isUltraShortNoiseFragment("ஆ")).toBe(true);
    expect(isUltraShortNoiseFragment("mm")).toBe(true);
  });

  it("drops English noise stubs that became fake turns (call 4943)", () => {
    expect(isUltraShortNoiseFragment("get")).toBe(true);
    expect(isUltraShortNoiseFragment("Oh")).toBe(true);
    expect(isUltraShortNoiseFragment("uh")).toBe(true);
    expect(isUltraShortNoiseFragment("the")).toBe(true);
  });

  it("keeps real one-/two-word replies that callers actually say", () => {
    expect(isUltraShortNoiseFragment("இருக்கு")).toBe(false);
    expect(isUltraShortNoiseFragment("நல்லா")).toBe(false);
    expect(isUltraShortNoiseFragment("சொல்லுங்க")).toBe(false);
    expect(isUltraShortNoiseFragment("நல்லா கேட்குது")).toBe(false);
    expect(isUltraShortNoiseFragment("call பண்ண")).toBe(false);
    expect(isUltraShortNoiseFragment("Madam இப்போ")).toBe(false);
    expect(isUltraShortNoiseFragment("Okay Madam")).toBe(false);
    expect(isUltraShortNoiseFragment("Okay Okay.")).toBe(false);
    expect(isUltraShortNoiseFragment("Hello")).toBe(false);
    expect(isUltraShortNoiseFragment("சரி")).toBe(false);
    expect(isUltraShortNoiseFragment("Yes")).toBe(false);
    expect(isUltraShortNoiseFragment("No, not yet.")).toBe(false);
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
  it("drops thin mid-cut scraps at or under the word threshold", () => {
    expect(isFalseInterruptionScrap("call பண்ண", 3)).toBe(true);
    expect(isFalseInterruptionScrap("Madam இப்போ", 3)).toBe(true);
    expect(isFalseInterruptionScrap("wait wait wait wait", 3)).toBe(false);
  });

  it("keeps real acks, questions, and audio-difficulty reports (call 2638)", () => {
    expect(isFalseInterruptionScrap("okay", 3)).toBe(false);
    expect(isFalseInterruptionScrap("சரி", 3)).toBe(false);
    expect(isFalseInterruptionScrap("ஆமா சார் ஆமா.", 3)).toBe(false);
    expect(isFalseInterruptionScrap("பண்ண முடியுமா?", 3)).toBe(false);
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

describe("isAccidentalInterruptPhrase", () => {
  it("identifies accidental interrupt phrases", () => {
    expect(isAccidentalInterruptPhrase("stop")).toBe(true);
    expect(isAccidentalInterruptPhrase("போதும்")).toBe(true);
    expect(isAccidentalInterruptPhrase("रुको")).toBe(true);
    expect(isAccidentalInterruptPhrase("hello world")).toBe(false);
  });

  describe("normalizeSttPhonetics", () => {
    it("replaces Futures-ல with features-ல", () => {
      expect(normalizeSttPhonetics("Futures-ல explain panna maattengrnga")).toBe("features-ல explain panna maattengrnga");
    });

    it("strips stray single digits prefixing Indic words", () => {
      expect(normalizeSttPhonetics("4 ஆமாம்")).toBe("ஆமாம்");
    });

    it("normalizes Tamil spoken emails into clean email strings", () => {
      expect(normalizeSttPhonetics("karthik 1 2 3 அட் ஜிமெல் டாட் காம்")).toBe("karthik123@gmail.com");
      expect(normalizeSttPhonetics("அட்ட ரைட் ஜிமெல் டாட் காம்")).toBe("@gmail.com");
    });

    it("normalizes Hindi spoken emails into clean email strings", () => {
      expect(normalizeSttPhonetics("user name ऐट जीमेल डॉट कॉम")).toBe("username@gmail.com");
    });

    it("normalizes letter-by-letter dictated emails with symbols into clean email strings", () => {
      expect(normalizeSttPhonetics("k a r t h i k e y a n 0 1 at gmail dot com")).toBe("karthikeyan01@gmail.com");
      expect(normalizeSttPhonetics("c o d e m a t e a i at gmail dot com")).toBe("codemateai@gmail.com");
      expect(normalizeSttPhonetics("k a r t h i k underscore zero one at gmail dot com")).toBe("karthik_01@gmail.com");
      expect(normalizeSttPhonetics("g o p i n w r k at gmail dot com")).toBe("gopinwrk@gmail.com");
    });
  });
});

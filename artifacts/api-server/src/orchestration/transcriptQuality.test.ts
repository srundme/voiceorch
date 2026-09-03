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
  isCallerAttentionUtterance,
  isBackchannelOnlyUtterance,
  hasCallerAddressToken,
  normalizeSttPhonetics,
  normalizeHinglishClock,
  coalescePendingTranscripts,
  signalsConversationalContinuation,
  looksLikeBookingTimeAnswer,
  looksLikeShortContextualAnswer,
  isDomainOrAcronymAnswer,
  preferStableTranscript,
  repairUnexpectedScriptLeak,
  isHardInterruptTranscript,
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

  it("does not treat Indic script as garbled English (language switch, not noise)", () => {
    const r = checkTranscriptQuality("નમસ્તે બોલો", { expectedLang: "en-IN" });
    expect(r.isGarbled).toBe(false);
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

  it("holds dangling English fragments so the follow-up final can merge (call 5578)", () => {
    // "Why don't we plan for" + "for today." was split into two finals; the
    // first must be held for coalesce, not answered with a false clarification.
    expect(checkTranscriptQuality("Why don't we plan for", { expectedLang: "en-IN" }).reason).toBe("truncated-dangling");
    expect(shouldHoldFragmentForCoalesce("Why don't we plan for", { expectedLang: "en-IN" })).toBe(true);
    // A complete short English answer must NOT be held.
    expect(shouldHoldFragmentForCoalesce("Yes, that works for me.", { expectedLang: "en-IN" })).toBe(false);
    expect(shouldHoldFragmentForCoalesce("No, not yet.", { expectedLang: "en-IN" })).toBe(false);
  });

  it("holds Devanagari fragments left dangling on a postposition (call 12541)", () => {
    // Saaras returns Devanagari for hi-IN, where the ASCII-only `\b` in the
    // Hinglish dangler list can never match — these all read as complete before.
    expect(checkTranscriptQuality("सौ करोड़ से", { expectedLang: "hi-IN" }).reason).toBe("truncated-dangling");
    expect(checkTranscriptQuality("मुझे 30 लाख का", { expectedLang: "hi-IN" }).reason).toBe("truncated-dangling");
    expect(checkTranscriptQuality("plot investment के", { expectedLang: "hi-IN" }).reason).toBe("truncated-dangling");
    expect(shouldHoldFragmentForCoalesce("सौ करोड़ से", { expectedLang: "hi-IN" })).toBe(true);
  });

  it("leaves complete Hindi answers alone", () => {
    expect(checkTranscriptQuality("रहने के लिए", { expectedLang: "hi-IN" }).reason).toBe("");
    expect(checkTranscriptQuality("हाँ Sir", { expectedLang: "hi-IN" }).reason).toBe("");
    expect(checkTranscriptQuality("ठीक है", { expectedLang: "hi-IN" }).reason).toBe("");
    expect(shouldHoldFragmentForCoalesce("रहने के लिए", { expectedLang: "hi-IN" })).toBe(false);
    // A lone particle is too often the whole answer to treat as a truncation.
    expect(checkTranscriptQuality("एक", { expectedLang: "hi-IN" }).reason).toBe("");
    expect(checkTranscriptQuality("तो", { expectedLang: "hi-IN" }).reason).toBe("");
  });

  it("keeps matching romanized Hinglish danglers", () => {
    expect(checkTranscriptQuality("main Jaipur se", { expectedLang: "hi-IN" }).reason).toBe("truncated-dangling");
  });

  it("holds Yes Ma'am so How are you can merge (call 4856 zigzag)", () => {
    expect(isBackchannelOnlyUtterance("Yes Ma'am")).toBe(true);
    expect(shouldHoldFragmentForCoalesce("Yes Ma'am", { expectedLang: "en-IN" })).toBe(true);
    expect(shouldHoldFragmentForCoalesce("How are you, Ma'am?", { expectedLang: "en-IN" })).toBe(false);
  });

  it("treats yeah but as an unfinished thought", () => {
    expect(shouldHoldFragmentForCoalesce("yeah but", { expectedLang: "en-IN" })).toBe(true);
    expect(shouldHoldFragmentForCoalesce("yeah but...", { expectedLang: "en-IN" })).toBe(true);
  });
});

describe("signalsConversationalContinuation", () => {
  it("detects dangling conversational structure, not just three phrases", () => {
    expect(signalsConversationalContinuation("I want to participate but...")).toBe(true);
    expect(signalsConversationalContinuation("Actually I was thinking")).toBe(true);
    expect(signalsConversationalContinuation("Yes, but...")).toBe(true);
    expect(signalsConversationalContinuation("நான் participate பண்ண")).toBe(true);
    expect(signalsConversationalContinuation("அது வந்து...")).toBe(true);
    expect(signalsConversationalContinuation("लेकिन मैं...")).toBe(true);
    expect(signalsConversationalContinuation("எனக்கு ஒரு...")).toBe(true);
    expect(signalsConversationalContinuation("yeah but")).toBe(true);
    expect(signalsConversationalContinuation("I want to participate in the")).toBe(true);
  });

  it("does not veto complete short answers", () => {
    expect(signalsConversationalContinuation("Yes, that works for me.")).toBe(false);
    expect(signalsConversationalContinuation("No, not yet.")).toBe(false);
    expect(signalsConversationalContinuation("I want to participate in the hackathon.")).toBe(false);
    expect(signalsConversationalContinuation("Okay.")).toBe(false);
    expect(signalsConversationalContinuation("சரி")).toBe(false);
    expect(signalsConversationalContinuation("हाँ Sir")).toBe(false);
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
    expect(isUltraShortNoiseFragment("Ji")).toBe(false);
    expect(isUltraShortNoiseFragment("B2B")).toBe(false);
    expect(isUltraShortNoiseFragment("CRM")).toBe(false);
  });
});

describe("call 20094 STT quality — domain answers and Kannada leak", () => {
  it("does not treat B2B/B2C/CRM as garbled all-caps noise", () => {
    expect(checkTranscriptQuality("B2B", { expectedLang: "hi-IN" }).isGarbled).toBe(false);
    expect(checkTranscriptQuality("B2C", { expectedLang: "hi-IN" }).isGarbled).toBe(false);
    expect(checkTranscriptQuality("CRM", { expectedLang: "hi-IN" }).isGarbled).toBe(false);
    expect(checkTranscriptQuality("API", { expectedLang: "en-IN" }).isGarbled).toBe(false);
    expect(isDomainOrAcronymAnswer("B2B")).toBe(true);
    expect(isDomainOrAcronymAnswer("बी टू बी")).toBe(true);
  });

  it("still flags spaced letter blobs as noise", () => {
    expect(checkTranscriptQuality("Z Z Z", { expectedLang: "en-IN" }).reason).toBe("short-allcaps-noise");
    expect(checkTranscriptQuality("QQ QQ", { expectedLang: "en-IN" }).reason).toBe("short-allcaps-noise");
  });

  it("keeps Ji and हाँ जी as real contextual answers", () => {
    expect(checkTranscriptQuality("Ji", { expectedLang: "hi-IN" }).isGarbled).toBe(false);
    expect(looksLikeShortContextualAnswer("Ji")).toBe(true);
    expect(looksLikeShortContextualAnswer("हाँ जी")).toBe(true);
    expect(looksLikeShortContextualAnswer("B2B")).toBe(true);
  });

  it("strips Kannada tokens from a Hindi-latched line", () => {
    const mixed = "invest ಮಾಡ್ತಾ रहे हैं और फिर और में रहते हैं";
    const repaired = repairUnexpectedScriptLeak(mixed, "hi-IN");
    expect(repaired).not.toMatch(/[\u0C80-\u0CFF]/);
    expect(repaired).toMatch(/invest/);
    expect(repaired).toMatch(/रहे हैं/);
  });

  it("prefers the clean Hindi partial over a Kannada-contaminated final", () => {
    expect(
      preferStableTranscript(
        "invest ಮಾಡ್ತಾ रहे हैं और फिर और में रहते हैं",
        "इन्वेस्ट करते हैं ना",
        "hi-IN",
      ),
    ).toBe("इन्वेस्ट करते हैं ना");
  });

  it("normalizes spoken B2B / B2C", () => {
    expect(normalizeSttPhonetics("मुझे बी टू बी चाहिए")).toContain("B2B");
    expect(normalizeSttPhonetics("b to c portal")).toContain("B2C");
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
    expect(isFalseInterruptionScrap("call பண்ண", 3)).toBe(false);
    expect(isFalseInterruptionScrap("Madam இப்போ", 3)).toBe(false);
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

  describe("coalescePendingTranscripts — call 5677 backlog", () => {
    const cr = "stt_final" as const;

    it("returns null for an empty queue", () => {
      expect(coalescePendingTranscripts([])).toBeNull();
    });

    it("returns the single entry unchanged", () => {
      const only = { text: "இப்போ இந்த ஆம்புலன்ஸ்.", emittedAt: 1000, closeReason: cr };
      expect(coalescePendingTranscripts([only])).toEqual(only);
    });

    it("drops greeting-era leftovers older than the newest ask", () => {
      const t0 = 1_000_000;
      const coalesced = coalescePendingTranscripts([
        { text: "ஹலோ.", emittedAt: t0, closeReason: cr },
        { text: "ஓகே.", emittedAt: t0 + 2_000, closeReason: cr },
        { text: "இப்போ இந்த ஆம்புலன்ஸ்.", emittedAt: t0 + 15_000, closeReason: cr },
        { text: "ஆ அந்த சார்ஜஸ்லாம் கவர் ஆகுமா", emittedAt: t0 + 18_000, closeReason: cr },
      ]);
      expect(coalesced?.text).toBe("இப்போ இந்த ஆம்புலன்ஸ். ஆ அந்த சார்ஜஸ்லாம் கவர் ஆகுமா");
      expect(coalesced?.emittedAt).toBe(t0 + 18_000);
    });

    it("skips backchannels when merging with a real question", () => {
      const t0 = 1_000_000;
      const coalesced = coalescePendingTranscripts([
        { text: "Okay.", emittedAt: t0, closeReason: cr },
        { text: "ஆமா.", emittedAt: t0 + 500, closeReason: cr },
        { text: "does ambulance cover charges?", emittedAt: t0 + 1_000, closeReason: cr },
      ]);
      expect(coalesced?.text).toBe("does ambulance cover charges?");
    });

    it("keeps only the newest two meaningful parts", () => {
      const t0 = 1_000_000;
      const coalesced = coalescePendingTranscripts([
        { text: "first question about coins", emittedAt: t0, closeReason: cr },
        { text: "second about wellness", emittedAt: t0 + 1_000, closeReason: cr },
        { text: "third about ambulance", emittedAt: t0 + 2_000, closeReason: cr },
      ]);
      expect(coalesced?.text).toBe("second about wellness third about ambulance");
    });

    it("falls back to the newest ack when the queue is all backchannels", () => {
      const t0 = 1_000_000;
      const coalesced = coalescePendingTranscripts([
        { text: "Okay.", emittedAt: t0, closeReason: cr },
        { text: "ஆமா.", emittedAt: t0 + 500, closeReason: cr },
      ]);
      expect(coalesced?.text).toBe("ஆமா.");
    });
  });
});

describe("looksLikeBookingTimeAnswer", () => {
  it("accepts Hindi/Hinglish slot answers discarded on call 14160", () => {
    expect(looksLikeBookingTimeAnswer("कल टेन थर्टी मैडम")).toBe(true);
    expect(looksLikeBookingTimeAnswer("tomorrow 10:30")).toBe(true);
    expect(looksLikeBookingTimeAnswer("eleven AM")).toBe(true);
  });

  it("accepts Tamil slot answers (call 14251 2pm talk-over)", () => {
    expect(looksLikeBookingTimeAnswer("2 pm")).toBe(true);
    expect(looksLikeBookingTimeAnswer("நாளைக்கு காலைல")).toBe(true);
    expect(looksLikeBookingTimeAnswer("ரெண்டு மணிக்கு வேணும்")).toBe(true);
  });

  it("rejects ordinary acks", () => {
    expect(looksLikeBookingTimeAnswer("हाँ।")).toBe(false);
    expect(looksLikeBookingTimeAnswer("okay madam")).toBe(false);
  });
});

describe("isHardInterruptTranscript", () => {
  it("allows stop / wait and booking slots, not garbled echo", () => {
    expect(isHardInterruptTranscript("wait")).toBe(true);
    expect(isHardInterruptTranscript("2 pm")).toBe(true);
    expect(isHardInterruptTranscript("Then you need to learn")).toBe(false);
    expect(isHardInterruptTranscript("okay madam")).toBe(false);
    expect(isHardInterruptTranscript("wait", true)).toBe(false);
  });

  it("does not treat a long pitch echo as a slot answer just because it says today/two", () => {
    expect(
      isHardInterruptTranscript(
        "Hi Krithika this is Angel calling today about two minutes for admission",
      ),
    ).toBe(false);
  });
});

describe("isCallerAttentionUtterance", () => {
  it("keeps Hello from being far-field-dropped (call 14315)", () => {
    expect(isCallerAttentionUtterance("Hello")).toBe(true);
    expect(isCallerAttentionUtterance("வணக்கம்")).toBe(true);
    expect(isCallerAttentionUtterance("காலைல 10 மணிக்கு சார்")).toBe(false);
  });
});

describe("normalizeHinglishClock — call 20113 Devanagari clock words", () => {
  it("converts वन थर्टी पी and इलेवन थर्टी", () => {
    expect(normalizeHinglishClock("वन थर्टी पी")).toBe("1:30 PM");
    expect(normalizeHinglishClock("इलेवन थर्टी")).toBe("11:30");
    expect(normalizeSttPhonetics("वन थर्टी पी")).toContain("1:30");
  });
});

describe("hasCallerAddressToken", () => {
  it("treats நீங்க as the caller addressing the agent, not TTS echo (call 14345)", () => {
    expect(hasCallerAddressToken(["ஒரு", "நிமிஷம்", "நீங்க"])).toBe(true);
    expect(hasCallerAddressToken(["ஒரு", "நிமிஷம்", "time"])).toBe(false);
  });
});

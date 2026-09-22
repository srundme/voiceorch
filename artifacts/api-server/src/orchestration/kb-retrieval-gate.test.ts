import { describe, it, expect } from "vitest";
import {
  decideKbRetrieval,
  resolveKbRetrievalGateMode,
  runKbRetrievalGate,
  shouldSkipKbRetrieval,
} from "./kb-retrieval-gate.js";

describe("resolveKbRetrievalGateMode", () => {
  it("defaults to on (production)", () => {
    expect(resolveKbRetrievalGateMode({})).toBe("on");
    expect(resolveKbRetrievalGateMode({ KB_RETRIEVAL_GATE: "" })).toBe("on");
    expect(resolveKbRetrievalGateMode({ KB_RETRIEVAL_GATE: "nope" })).toBe("on");
  });

  it("accepts shadow and explicit off", () => {
    expect(resolveKbRetrievalGateMode({ KB_RETRIEVAL_GATE: "shadow" })).toBe("shadow");
    expect(resolveKbRetrievalGateMode({ KB_RETRIEVAL_GATE: "OFF" })).toBe("off");
    expect(resolveKbRetrievalGateMode({ KB_RETRIEVAL_GATE: "ON" })).toBe("on");
  });
});

describe("decideKbRetrieval — skip conversational", () => {
  const skip = [
    "Okay",
    "Hmm",
    "Yes",
    "No",
    "Can you repeat that?",
    "okay sir",
    "சரி",
    "thanks",
    "hello",
  ];
  for (const utterance of skip) {
    it(`skips "${utterance}"`, () => {
      const r = decideKbRetrieval(utterance);
      expect(r.decision).toBe("skip");
      expect(r.reason).toBe("conversational");
    });
  }
});

describe("decideKbRetrieval — skip caller facts", () => {
  const skip = [
    "My name is Karthik",
    "I have 2 years experience",
    "I'm from Chennai",
    "I am a fresher",
    "I live in Chennai",
  ];
  for (const utterance of skip) {
    it(`skips "${utterance}"`, () => {
      const r = decideKbRetrieval(utterance);
      expect(r.decision).toBe("skip");
      expect(r.reason).toBe("caller_fact");
    });
  }
});

describe("decideKbRetrieval — retrieve factual", () => {
  const retrieve = [
    "What's the salary?",
    "Is transport provided?",
    "Can freshers apply?",
    "What's covered in this policy?",
    "Which hospitals are covered?",
    "What are the exclusions?",
    "What about transport?",
    "How much?",
    "Is it free?",
    "Can graduates apply?",
    "What about girls?",
    "How many days?",
  ];
  for (const utterance of retrieve) {
    it(`retrieves "${utterance}"`, () => {
      const r = decideKbRetrieval(utterance);
      expect(r.decision).toBe("retrieve");
      expect(r.reason).toBe("factual_question");
    });
  }
});

describe("decideKbRetrieval — fail open", () => {
  it("treats unknown statements as retrieve/unclear", () => {
    const r = decideKbRetrieval("Tell them I'll join Monday after I check with my manager.");
    expect(r.decision).toBe("retrieve");
    expect(r.reason).toBe("unclear");
  });

  it("runKbRetrievalGate never throws and records decisionMs", () => {
    const r = runKbRetrievalGate("Okay");
    expect(r.decision).toBe("skip");
    expect(r.reason).toBe("conversational");
    expect(r.utterance).toBe("Okay");
    expect(r.decisionMs).toBeGreaterThanOrEqual(0);
    expect(r.decisionMs).toBeLessThan(50);
  });
});

  describe("decideKbRetrieval — skip language control", () => {
  const skip = [
    "Can you speak in Tamil?",
    "Tamil please.",
    "Speak in English.",
    "தமிழ்ல பேசுங்க.",
    "Hindi mein bolo.",
    "தமிழ்",
    "English-ல பேசுறீங்களா? Can you speak to English?",
    "Are you speaking in Tamil?",
    "Why are you speaking in English?",
    "Which language is easier for you to speak in?",
    "Ma'am, can you talk in Hindi?",
    "Can you speak Malayalam?",
    "I only understand Hindi.",
    "I am comfortable only with Hindi",
    "தமிழ்ல பேசுங்க",
    "தமிழில் பேச முடியுமா?",
    "മലയാളത്തിൽ സംസാരിക്കാമോ?",
    "മലയാളത്തിൽ പറയാമോ?",
    "తెలుగులో మాట్లాడగలరా?",
    "తెలుగులో చెప్పండి",
    "ಕನ್ನಡದಲ್ಲಿ ಮಾತನಾಡಬಹುದಾ?",
    "மலையாளத்துல பேசலாமா?",
    "എനിക്ക് മലയാളത്തിൽ സംസാരിക്കാമോ?",
    "തമിഴിൽ സംസാരിക്കുന്നത് ആണോ?",
  ];
  for (const utterance of skip) {
    it(`skips "${utterance}"`, () => {
      const r = decideKbRetrieval(utterance);
      expect(r.decision).toBe("skip");
      expect(r.reason).toBe("language_control");
      expect(r.utteranceClass).toBe("language_control");
    });
  }

  it("still retrieves a knowledge question asked in a language", () => {
    const r = decideKbRetrieval("Can you explain the premium in Tamil?");
    expect(r.decision).toBe("retrieve");
    expect(r.reason).toBe("factual_question");
  });

  it("retrieves mixed knowledge + language control", () => {
    for (const utterance of [
      "Explain the premium in Malayalam.",
      "Tell me the coverage in Tamil.",
      "இந்த plan-ஐ தமிழ்ல explain பண்ணுங்க.",
    ]) {
      const r = decideKbRetrieval(utterance);
      expect(r.decision).toBe("retrieve");
      expect(r.reason).toBe("factual_question");
    }
  });
});

describe("decideKbRetrieval — skip non-KB person questions", () => {
  const offerings = ["Elevate", "Care Supreme"];

  it("skips a person-issue question when the name is not a knowledge object", () => {
    for (const utterance of [
      "What's Bhavya's issue?",
      "So what is the issue for Pabya?",
      "Can you mention what is the issue for Bhavya?",
    ]) {
      const r = decideKbRetrieval(utterance, { knownOfferings: offerings });
      expect(r.decision).toBe("skip");
      expect(r.utteranceClass).toBe("caller_fact");
    }
  });

  it("retrieves when the named thing is an attached knowledge object", () => {
    const r = decideKbRetrieval("What's Elevate's waiting period?", { knownOfferings: offerings });
    expect(r.decision).toBe("retrieve");
    expect(r.utteranceClass).toBe("knowledge_query");
  });
});

describe("decideKbRetrieval — other conversation-control skips", () => {
  it("skips specialist-call booking", () => {
    const r = decideKbRetrieval("Okay Ma'am shall we book specialist call?");
    expect(r.decision).toBe("skip");
    expect(r.utteranceClass).toBe("call_control");
  });

  it("skips hear/repair as repeat", () => {
    const r = decideKbRetrieval(
      "One thing, please speak clearly as you are mixing the sentences, I couldn't able to hear what you are saying.",
    );
    expect(r.decision).toBe("skip");
    expect(r.utteranceClass).toBe("repeat_request");
  });
});

describe("shouldSkipKbRetrieval", () => {
  it("only skips when mode is on", () => {
    expect(shouldSkipKbRetrieval("off", "skip")).toBe(false);
    expect(shouldSkipKbRetrieval("shadow", "skip")).toBe(false);
    expect(shouldSkipKbRetrieval("on", "skip")).toBe(true);
    expect(shouldSkipKbRetrieval("on", "retrieve")).toBe(false);
  });
});

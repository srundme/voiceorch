import { describe, expect, it } from "vitest";
import {
  classifyBackchannelContext,
  getBackchannelFillers,
  isRiskyFillerContext,
  pickBackchannelFiller,
  rememberFillerPhrase,
  parseBackchannelPhrases,
} from "./backchannel.js";

describe("backchannel fillers — contextual human covers", () => {
  it("uses listening-only Okay and Ok for questions", () => {
    const pool = getBackchannelFillers("ta-IN", {
      callerTranscript: "என்ன விலை?",
    });
    expect(pool).toEqual(["Okay.", "Ok."]);
    expect(pool).not.toContain("ம்.");
    expect(pool).not.toContain("சரி.");
    expect(pool).not.toContain("I see.");
  });

  it("uses listening-only Okay and Ok for refusal / cancel turns", () => {
    const pool = getBackchannelFillers("ta-IN", {
      callerTranscript: "I don't want this, cancel it",
    });
    expect(pool).toEqual(["Okay.", "Ok."]);
    expect(pool).not.toContain("சரி.");
    expect(pool).not.toContain("ம்.");
  });

  it("only provides Okay and Ok across statements", () => {
    const pool = getBackchannelFillers("ta-IN", {
      callerTranscript: "நான் சென்னையில இருக்கேன்",
    });
    expect(pool).toEqual(["Okay.", "Ok."]);
    expect(pool).not.toContain("ம்.");
    expect(pool).not.toContain("சரி.");
    expect(pool).not.toContain("Got it.");
  });

  it("keeps English and Tamil on Okay and Ok", () => {
    const english = getBackchannelFillers("en-IN", { callerTranscript: "I live in Chennai" });
    expect(english).toEqual(["Okay.", "Ok."]);

    const tamil = getBackchannelFillers("ta-IN", { callerTranscript: "நான் சென்னையில இருக்கேன்" });
    expect(tamil).toEqual(["Okay.", "Ok."]);
  });

  it("uses Okay and Ok on Hindi statements and questions", () => {
    expect(getBackchannelFillers("hi-IN", { callerTranscript: "मैं दिल्ली में रहता हूँ" }))
      .toEqual(["Okay.", "Ok."]);
    expect(getBackchannelFillers("hi-IN", { callerTranscript: "क्या आप मदद कर सकते हैं?" }))
      .toEqual(["Okay.", "Ok."]);
  });

  it("still classifies story and numeric turns", () => {
    expect(classifyBackchannelContext(
      "So I was talking to them and then after that we also checked the shop again",
    )).toBe("story");
    expect(classifyBackchannelContext("My salary is 45000 rupees")).toBe("numeric");
    expect(getBackchannelFillers("en-IN", {
      callerTranscript: "My salary is 45000 rupees",
    })).toEqual(["Okay.", "Ok."]);
  });

  it("keeps English listening fillers when explicitly locked to English", () => {
    const pool = getBackchannelFillers("ta-IN", {
      englishStrictAck: true,
      callerTranscript: "I live in Chennai",
    });
    expect(pool).toEqual(["Okay.", "Ok."]);
    expect(pool).not.toContain("ம்.");
    expect(pool).not.toContain("Got it.");
  });

  it("avoids recent fillers when picking", () => {
    const picked = pickBackchannelFiller("en-IN", ["Okay."], {
      callerTranscript: "I live in Chennai",
      rng: () => 0,
    });
    expect(picked).toBe("Ok.");
  });

  it("picks Okay or Ok on an English question", () => {
    const picked = pickBackchannelFiller("en-IN", [], {
      callerTranscript: "Can you help?",
      rng: () => 0,
    });
    expect(["Okay.", "Ok."]).toContain(picked);
  });

  it("honors a custom Okay-only pool", () => {
    expect(getBackchannelFillers("en-IN", {
      customFillers: ["Okay."],
      callerTranscript: "Can you help?",
    })).toEqual(["Okay."]);
    expect(pickBackchannelFiller("en-IN", [], {
      customFillers: ["Okay."],
      callerTranscript: "How can you help me?",
    })).toBe("Okay.");
  });

  it("parses the backchannel_phrases column", () => {
    expect(parseBackchannelPhrases("Okay.")).toEqual(["Okay."]);
    expect(parseBackchannelPhrases("Okay., Hmm.")).toEqual(["Okay.", "Hmm."]);
    expect(parseBackchannelPhrases("  ")).toBeNull();
    expect(parseBackchannelPhrases(null)).toBeNull();
  });

  it("rememberFillerPhrase keeps a ring of 5", () => {
    const recent: string[] = [];
    for (const p of ["Hmm.", "Mmm.", "Mhmm.", "Mm-hmm.", "Uh-huh.", "Okay."]) {
      rememberFillerPhrase(recent, p);
    }
    expect(recent).toEqual(["Mmm.", "Mhmm.", "Mm-hmm.", "Uh-huh.", "Okay."]);
  });
});

describe("isRiskyFillerContext", () => {
  it("flags English questions and refusals", () => {
    expect(isRiskyFillerContext("Can you help me?")).toBe(true);
    expect(isRiskyFillerContext("I don't want this")).toBe(true);
    expect(isRiskyFillerContext("I live in Chennai")).toBe(false);
  });
});

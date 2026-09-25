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
  it("uses listening-only for questions (no soft ack, no language acks)", () => {
    const pool = getBackchannelFillers("ta-IN", {
      callerTranscript: "என்ன விலை?",
    });
    expect(pool).toEqual(["ம்.", "ஹ்ம்ம்.", "ம்ம்.", "ஹ்ம்."]);
    expect(pool).not.toContain("Okay.");
    expect(pool).not.toContain("சரி.");
    expect(pool).not.toContain("I see.");
  });

  it("uses listening-only for refusal / cancel turns", () => {
    const pool = getBackchannelFillers("ta-IN", {
      callerTranscript: "I don't want this, cancel it",
    });
    expect(pool).toEqual(["ம்.", "ஹ்ம்ம்.", "ம்ம்.", "ஹ்ம்."]);
    expect(pool).not.toContain("சரி.");
    expect(pool).not.toContain("Okay.");
  });

  it("does not inject சரி on Tamil statements — the LLM already says it", () => {
    const pool = getBackchannelFillers("ta-IN", {
      callerTranscript: "நான் சென்னையில இருக்கேன்",
    });
    expect(pool).toContain("ம்.");
    expect(pool).toContain("ஓ.");
    expect(pool).not.toContain("சரி.");
    expect(pool).not.toContain("Okay.");
    expect(pool).not.toContain("Got it.");
    expect(pool).not.toContain("अच्छा");
  });

  it("keeps English and Tamil on listening sounds, without got-it or perfect", () => {
    const english = getBackchannelFillers("en-IN", { callerTranscript: "I live in Chennai" });
    expect(english).toEqual(["Hmm.", "Mmm.", "Mhmm.", "Mm-hmm.", "Uh-huh."]);
    expect(english.join(" ")).not.toMatch(/got it|perfect|okay|right|alright|i see/i);

    const tamil = getBackchannelFillers("ta-IN", { callerTranscript: "நான் சென்னையில இருக்கேன்" });
    expect(tamil.join(" ")).not.toMatch(/got it|perfect|okay|अच्छा/i);
  });

  it("uses Okay and acha on Hindi statements, and a listen sound on questions", () => {
    expect(getBackchannelFillers("hi-IN", { callerTranscript: "मैं दिल्ली में रहता हूँ" }))
      .toEqual(["Okay.", "अच्छा."]);
    expect(getBackchannelFillers("hi-IN", { callerTranscript: "क्या आप मदद कर सकते हैं?" }))
      .toEqual(["हम्म.", "म्म."]);
  });

  it("still classifies story and numeric turns", () => {
    expect(classifyBackchannelContext(
      "So I was talking to them and then after that we also checked the shop again",
    )).toBe("story");
    expect(classifyBackchannelContext("My salary is 45000 rupees")).toBe("numeric");
    expect(getBackchannelFillers("en-IN", {
      callerTranscript: "My salary is 45000 rupees",
    })).toEqual(["Hmm.", "Mmm.", "Mhmm.", "Mm-hmm.", "Uh-huh."]);
  });

  it("keeps English listening fillers when explicitly locked to English", () => {
    const pool = getBackchannelFillers("ta-IN", {
      englishStrictAck: true,
      callerTranscript: "I live in Chennai",
    });
    expect(pool).toEqual(["Hmm.", "Mmm.", "Mhmm.", "Mm-hmm.", "Uh-huh."]);
    expect(pool).not.toContain("ம்.");
    expect(pool).not.toContain("Got it.");
  });

  it("avoids recent fillers when picking", () => {
    const picks = new Set<string>();
    for (let n = 0; n < 20; n++) {
      picks.add(pickBackchannelFiller("en-IN", ["Hmm.", "Mmm.", "Mhmm."], {
        callerTranscript: "I live in Chennai",
        rng: () => (n * 0.17) % 1,
      })!);
    }
    expect(picks.has("Hmm.")).toBe(false);
    expect(picks.has("Mmm.")).toBe(false);
    expect(picks.has("Mhmm.")).toBe(false);
    expect(picks.size).toBeGreaterThan(0);
  });

  it("never says Okay or acha on an English question", () => {
    const picked = pickBackchannelFiller("en-IN", [], {
      callerTranscript: "Can you help?",
      rng: () => 0,
    });
    expect(picked).not.toBe("Okay.");
    expect(picked).not.toBe("अच्छा.");
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

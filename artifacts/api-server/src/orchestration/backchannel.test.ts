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

  it("uses a varied English soft-ack bank on safe statements", () => {
    const pool = getBackchannelFillers("en-IN", { callerTranscript: "I live in Chennai" });
    expect(pool).toEqual(expect.arrayContaining(["Okay.", "Got it.", "I see.", "Right.", "Alright."]));
    expect(pool.length).toBeGreaterThanOrEqual(5);
    expect(getBackchannelFillers("en-IN", { callerTranscript: "Can you help?" }))
      .toEqual(["Hmm.", "Mmm.", "Mhmm.", "Mm-hmm.", "Uh-huh."]);
  });

  it("uses story / numeric pools for longer or number-heavy turns", () => {
    expect(classifyBackchannelContext(
      "So I was talking to them and then after that we also checked the shop again",
    )).toBe("story");
    expect(classifyBackchannelContext("My salary is 45000 rupees")).toBe("numeric");

    const story = getBackchannelFillers("en-IN", {
      callerTranscript: "So I was talking to them and then after that we also checked the shop again",
    });
    expect(story).toEqual(expect.arrayContaining(["I see.", "Got it.", "Right."]));

    const numeric = getBackchannelFillers("en-IN", {
      callerTranscript: "My salary is 45000 rupees",
    });
    expect(numeric).toEqual(expect.arrayContaining(["Okay.", "Got it.", "Mhm."]));
    expect(numeric).not.toContain("Alright.");
  });

  it("keeps English fillers when explicitly locked to English", () => {
    const pool = getBackchannelFillers("ta-IN", {
      englishStrictAck: true,
      callerTranscript: "I live in Chennai",
    });
    expect(pool).toEqual(expect.arrayContaining(["Okay.", "Got it.", "I see."]));
    expect(pool).not.toContain("ம்.");
  });

  it("avoids recent fillers when picking", () => {
    const picks = new Set<string>();
    for (let n = 0; n < 20; n++) {
      picks.add(pickBackchannelFiller("en-IN", ["Okay.", "Got it.", "I see."], {
        callerTranscript: "I live in Chennai",
        rng: () => (n * 0.17) % 1,
      })!);
    }
    expect(picks.has("Okay.")).toBe(false);
    expect(picks.has("Got it.")).toBe(false);
    expect(picks.has("I see.")).toBe(false);
    expect(picks.size).toBeGreaterThan(0);
  });

  it("never says Okay on a question even when the roll would pick it", () => {
    expect(pickBackchannelFiller("en-IN", [], {
      callerTranscript: "Can you help?",
      rng: () => 0,
    })).not.toBe("Okay.");
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
    for (const p of ["Okay.", "Hmm.", "Mmm.", "Got it.", "I see.", "Right."]) {
      rememberFillerPhrase(recent, p);
    }
    expect(recent).toEqual(["Hmm.", "Mmm.", "Got it.", "I see.", "Right."]);
  });
});

describe("isRiskyFillerContext", () => {
  it("flags English questions and refusals", () => {
    expect(isRiskyFillerContext("Can you help me?")).toBe(true);
    expect(isRiskyFillerContext("I don't want this")).toBe(true);
    expect(isRiskyFillerContext("I live in Chennai")).toBe(false);
  });
});

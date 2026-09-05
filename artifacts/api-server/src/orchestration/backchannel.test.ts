import { describe, expect, it } from "vitest";
import {
  getBackchannelFillers,
  isRiskyFillerContext,
  pickBackchannelFiller,
  rememberFillerPhrase,
} from "./backchannel.js";

const ONLY_OKAY_HMM_MMM = ["Okay.", "Hmm.", "Mmm."];

describe("backchannel fillers — okay / hmm / mmm only", () => {
  it("uses hmm/mmm only for questions (no Okay, no language acks)", () => {
    const pool = getBackchannelFillers("ta-IN", {
      callerTranscript: "என்ன விலை?",
    });
    expect(pool).toEqual(["Hmm.", "Mmm."]);
    expect(pool).not.toContain("Okay.");
    expect(pool).not.toContain("சரி");
    expect(pool).not.toContain("I see.");
    expect(pool).not.toContain("Mm-hmm.");
  });

  it("uses hmm/mmm only for refusal / cancel turns", () => {
    const pool = getBackchannelFillers("ta-IN", {
      callerTranscript: "I don't want this, cancel it",
    });
    expect(pool).toEqual(["Hmm.", "Mmm."]);
    expect(pool).not.toContain("சரி");
    expect(pool).not.toContain("Okay.");
  });

  it("allows Okay on safe statements, still only the three words", () => {
    const pool = getBackchannelFillers("hi-IN", {
      callerTranscript: "நான் சென்னையில இருக்கேன்",
    });
    expect(pool.sort()).toEqual([...ONLY_OKAY_HMM_MMM].sort());
    expect(pool).not.toContain("சரிங்க");
    expect(pool).not.toContain("Got it.");
    expect(pool).not.toContain("अच्छा");
  });

  it("same three-word bank in English", () => {
    expect(getBackchannelFillers("en-IN", { callerTranscript: "I live in Chennai" }).sort())
      .toEqual([...ONLY_OKAY_HMM_MMM].sort());
    expect(getBackchannelFillers("en-IN", { callerTranscript: "Can you help?" }))
      .toEqual(["Hmm.", "Mmm."]);
  });

  it("avoids the last few spoken fillers", () => {
    const recent = ["Hmm.", "Mmm."];
    for (let i = 0; i < 20; i++) {
      const phrase = pickBackchannelFiller("en-IN", recent, {
        callerTranscript: "I live in Chennai",
      });
      expect(phrase).toBe("Okay.");
    }
  });

  it("rememberFillerPhrase keeps a ring of 3", () => {
    const recent: string[] = [];
    rememberFillerPhrase(recent, "Okay.");
    rememberFillerPhrase(recent, "Hmm.");
    rememberFillerPhrase(recent, "Mmm.");
    rememberFillerPhrase(recent, "Okay.");
    expect(recent).toEqual(["Hmm.", "Mmm.", "Okay."]);
  });
});

describe("isRiskyFillerContext", () => {
  it("flags English questions and refusals", () => {
    expect(isRiskyFillerContext("Can you help me?")).toBe(true);
    expect(isRiskyFillerContext("I don't want this")).toBe(true);
    expect(isRiskyFillerContext("I live in Chennai")).toBe(false);
  });
});

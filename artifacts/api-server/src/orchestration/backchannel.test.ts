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

  it("picks Okay 80% and Hmm/Mmm 20% on safe statements", () => {
    const rolls = [
      0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.79, // 8× Okay
      0.8, 0.0, // listening → Hmm
      0.95, 0.9, // listening → Mmm
    ];
    let i = 0;
    const rng = () => rolls[Math.min(i++, rolls.length - 1)]!;
    const picks: string[] = [];
    for (let n = 0; n < 10; n++) {
      picks.push(pickBackchannelFiller("en-IN", [], {
        callerTranscript: "I live in Chennai",
        rng,
      })!);
    }
    expect(picks.filter((p) => p === "Okay.")).toHaveLength(8);
    expect(picks.filter((p) => p === "Hmm." || p === "Mmm.")).toHaveLength(2);
    expect(picks).toContain("Hmm.");
    expect(picks).toContain("Mmm.");
  });

  it("never says Okay on a question even when the roll would pick it", () => {
    expect(pickBackchannelFiller("en-IN", [], {
      callerTranscript: "Can you help?",
      rng: () => 0,
    })).not.toBe("Okay.");
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

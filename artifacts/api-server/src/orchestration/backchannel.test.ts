import { describe, expect, it } from "vitest";
import {
  getBackchannelFillers,
  isRiskyFillerContext,
  pickBackchannelFiller,
  rememberFillerPhrase,
} from "./backchannel.js";

describe("Tamil backchannel fillers", () => {
  it("uses listening-only fillers for questions (no soft சரி/ஓகே)", () => {
    const pool = getBackchannelFillers("ta-IN", {
      callerTranscript: "என்ன விலை?",
    });
    expect(pool.length).toBeGreaterThanOrEqual(2);
    expect(pool).toContain("ம்ம்");
    expect(pool).not.toContain("சரி");
    expect(pool).not.toContain("ஓகே");
  });

  it("uses listening-only for refusal / cancel turns", () => {
    const pool = getBackchannelFillers("ta-IN", {
      callerTranscript: "வேண்டாம் ரத்து பண்ணுங்க",
    });
    expect(pool).not.toContain("சரி");
    expect(pool).toContain("ம்ம்");
  });

  it("allows soft acks on safe statements", () => {
    const pool = getBackchannelFillers("ta-IN", {
      callerTranscript: "நான் சென்னையில இருக்கேன்",
    });
    expect(pool).toContain("சரிங்க");
    expect(pool).toContain("ம்ம்");
  });

  it("avoids the last few spoken fillers", () => {
    const recent = ["ம்ம்", "ஆஹா", "அப்படியா"];
    for (let i = 0; i < 20; i++) {
      const phrase = pickBackchannelFiller("ta-IN", recent, {
        callerTranscript: "என்ன விலை?",
      });
      expect(phrase).toBeTruthy();
      expect(recent.map((r) => r.toLowerCase())).not.toContain(phrase!.toLowerCase());
    }
  });

  it("rememberFillerPhrase keeps a ring of 3", () => {
    const recent: string[] = [];
    rememberFillerPhrase(recent, "ம்ம்");
    rememberFillerPhrase(recent, "ஆஹா");
    rememberFillerPhrase(recent, "அப்படியா");
    rememberFillerPhrase(recent, "ஹ்ம்");
    expect(recent).toEqual(["ஆஹா", "அப்படியா", "ஹ்ம்"]);
  });
});

describe("isRiskyFillerContext", () => {
  it("flags English questions and refusals", () => {
    expect(isRiskyFillerContext("Can you help me?")).toBe(true);
    expect(isRiskyFillerContext("I don't want this")).toBe(true);
    expect(isRiskyFillerContext("I live in Chennai")).toBe(false);
  });
});

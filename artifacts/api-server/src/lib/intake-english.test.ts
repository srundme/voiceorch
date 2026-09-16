import { describe, it, expect } from "vitest";
import { englishRatingForForm, updateEnglishRead } from "./intake-english.js";
import type { IntakeEnglishRead } from "./intake-dispositions.js";

function fold(lines: string[], start: IntakeEnglishRead | null = null): IntakeEnglishRead {
  return lines.reduce<IntakeEnglishRead | null>((acc, text) => updateEnglishRead(acc, { text }), start)
    ?? { rating: "Good", confidence: 0, evidence: [], samples: 0 };
}

describe("updateEnglishRead", () => {
  it("ignores turns too short to say anything about fluency", () => {
    const read = fold(["yes", "okay", "hmm"]);
    expect(read.samples).toBe(0);
    expect(englishRatingForForm(read)).toBeNull();
  });

  it("rates a fluent speaker highly", () => {
    const read = fold([
      "Good morning, actually I am currently working as a customer service executive handling an international process",
      "I graduated in 2021 and I have around three years of experience in customer support, mostly voice",
      "I am comfortable with the US shift because I have been doing night shifts previously as well",
      "Regarding salary I am expecting something around thirty five thousand, however I am open to discussing it",
    ]);
    expect(["Excellent", "Very good"]).toContain(read.rating);
    expect(read.evidence).toContain("long, well-connected sentences");
  });

  it("rates a struggling speaker poorly", () => {
    const read = fold([
      "um sorry come again please",
      "um uh i not understand madam",
      "please repeat, i dont understand",
      "no english madam, hindi me bolo",
    ]);
    expect(read.rating).toBe("Poor");
    expect(read.evidence).toContain("asked for repetition or said they cannot follow English");
  });

  it("counts a breakdown even in a very short turn", () => {
    const read = updateEnglishRead(null, { text: "come again" });
    expect(read.samples).toBe(1);
    expect(read.rating).toBe("Poor");
  });

  it("treats a non-English reply as non-English, not as accented English", () => {
    const read = updateEnglishRead(null, { text: "मैं हिंदी में बात करूंगा" });
    expect(read.samples).toBe(1);
    expect(read.evidence).toContain("answered in another language");
  });

  it("trusts a detected language code over the script", () => {
    // Romanised Tamil comes back in Latin script, so the language code is the
    // only signal that this was not English.
    const read = updateEnglishRead(null, {
      text: "naan velaikku romba naal thedi paakuren sir",
      detectedLanguage: "ta-IN",
    });
    expect(read.evidence).toContain("answered in another language");
  });

  it("builds confidence as more turns land", () => {
    const one = fold(["I am looking for a job in customer support"]);
    const many = fold([
      "I am looking for a job in customer support",
      "I stay in Whitefield which is close to most of the offices",
      "I completed my graduation in commerce from Bangalore University",
      "I can join immediately because I am not working anywhere right now",
      "Night shift is completely fine for me, I have done it before",
    ]);
    expect(one.confidence).toBeLessThan(many.confidence);
    expect(many.confidence).toBe(1);
  });

  it("does not record the same observation twice", () => {
    const read = fold([
      "I stay in Whitefield which is quite close to the office actually",
      "I stay in Whitefield which is quite close to the office actually",
    ]);
    expect(read.evidence).toEqual([...new Set(read.evidence)]);
  });

  it("leaves the read alone on an empty turn", () => {
    const before = fold(["I have three years of BPO experience in voice support"]);
    expect(updateEnglishRead(before, { text: "   " })).toEqual(before);
  });
});

describe("englishRatingForForm", () => {
  it("returns nothing until there is something to judge", () => {
    expect(englishRatingForForm(null)).toBeNull();
    expect(englishRatingForForm({ rating: "Good", confidence: 0, evidence: [], samples: 0 })).toBeNull();
  });

  it("returns the rating once the caller has spoken", () => {
    expect(englishRatingForForm({ rating: "Very good", confidence: 0.6, evidence: [], samples: 3 }))
      .toBe("Very good");
  });
});

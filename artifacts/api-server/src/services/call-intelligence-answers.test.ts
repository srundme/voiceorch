import { describe, expect, it } from "vitest";
import { normalizeAnalyticsAnswers, type CampaignAnalyticsQuestion } from "./call-intelligence-answers.js";

const qs: CampaignAnalyticsQuestion[] = [
  { id: "competitor", label: "Mentioned competitor?", type: "boolean" },
  { id: "demo", label: "Demo interest", type: "enum", options: ["yes", "no", "maybe"] },
  { id: "note", label: "Key note", type: "text" },
];

describe("normalizeAnalyticsAnswers", () => {
  it("coerces boolean and enum answers", () => {
    const r = normalizeAnalyticsAnswers(
      { competitor: "yes", demo: "Maybe", note: "  wants pricing  " },
      qs,
    );
    expect(r.competitor).toBe(true);
    expect(r.demo).toBe("maybe");
    expect(r.note).toBe("wants pricing");
  });

  it("nulls unknown enum and missing keys", () => {
    const r = normalizeAnalyticsAnswers({ demo: "later" }, qs);
    expect(r.competitor).toBeNull();
    expect(r.demo).toBeNull();
    expect(r.note).toBeNull();
  });
});

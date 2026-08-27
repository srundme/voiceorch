import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  callerProfilesTable: {},
  scheduledCallbacksTable: {},
  callerFactsTable: {},
  callerCallArchiveTable: {},
  callerSentencesTable: {},
  callerFactSentenceLinksTable: {},
  callerEpisodeFactLinksTable: {},
  pendingCallerFactsTable: {},
  canonicalizeCallerKey: (p: string) => p,
  isRealPhoneNumber: () => true,
  humanPhone: (p: string) => p,
  resolveCallerKey: (_d: string, f: string) => f,
}));

import { matchCallerFactPatterns } from "./callerMemory.js";

describe("matchCallerFactPatterns — age", () => {
  const cases: Array<[string, string]> = [
    ["I am 32 years old", "32"],
    ["my age is 28", "28"],
    ["என்னோட age 25 madam", "25"],
    ["எனக்கு 32 வயசு", "32"],
    ["என்னோட வயசு 25", "25"],
    ["age is 40", "40"],
    ["मेरी उम्र 35", "35"],
  ];
  for (const [phrase, age] of cases) {
    it(`extracts age from "${phrase}"`, () => {
      expect(matchCallerFactPatterns(phrase).get("age")).toBe(age);
    });
  }
});

describe("matchCallerFactPatterns — location", () => {
  it("matches lowercase STT city names", () => {
    expect(matchCallerFactPatterns("I am from chennai").get("location")?.toLowerCase())
      .toBe("chennai");
  });

  it("matches code-mixed Tamil city cue", () => {
    expect(matchCallerFactPatterns("என்னோட ஊர் Chennai").get("location")).toMatch(/chennai/i);
  });

  it("rejects day-of-week false positives", () => {
    expect(matchCallerFactPatterns("I am calling from Saturday").has("location")).toBe(false);
  });
});

describe("matchCallerFactPatterns — occupation / company", () => {
  it("matches English occupation", () => {
    expect(matchCallerFactPatterns("I work as a teacher").get("occupation")?.toLowerCase())
      .toContain("teacher");
  });

  it("matches company_name", () => {
    expect(matchCallerFactPatterns("I work at Infosys").get("company_name")).toMatch(/infosys/i);
  });

  it("matches Tamil job cue", () => {
    expect(matchCallerFactPatterns("என்னோட வேலை doctor").get("occupation")?.toLowerCase())
      .toContain("doctor");
  });
});

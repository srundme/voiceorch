import { describe, expect, it } from "vitest";
import {
  buildCallDirectionRule,
  inboundPurposeExamples,
  resolveCallOpeningLanguage,
  resolveInboundGreetingTtsSpeed,
  resolveOpeningLanguageKey,
} from "./call-direction-rules.js";

describe("resolveOpeningLanguageKey", () => {
  it("maps memory codes and names", () => {
    expect(resolveOpeningLanguageKey("ta")).toBe("ta");
    expect(resolveOpeningLanguageKey("tamil")).toBe("ta");
    expect(resolveOpeningLanguageKey("ta-IN")).toBe("ta");
    expect(resolveOpeningLanguageKey("hi")).toBe("hi");
    expect(resolveOpeningLanguageKey("english")).toBe("en");
  });

  it("defaults empty to english", () => {
    expect(resolveOpeningLanguageKey(null)).toBe("en");
    expect(resolveOpeningLanguageKey("")).toBe("en");
  });
});

describe("resolveCallOpeningLanguage", () => {
  it("prefers memory language_pref", () => {
    expect(resolveCallOpeningLanguage({
      memoryLanguagePref: "tamil",
      agentLanguage: "en-IN",
      languageAutoDetect: true,
    })).toMatchObject({ key: "ta", source: "memory" });
  });

  it("defaults to English when no memory and auto-detect", () => {
    expect(resolveCallOpeningLanguage({
      memoryLanguagePref: null,
      agentLanguage: "ta-IN",
      languageAutoDetect: true,
    })).toMatchObject({ key: "en", source: "english_default" });
  });

  it("keeps agent language when fixed-language and no memory", () => {
    expect(resolveCallOpeningLanguage({
      memoryLanguagePref: null,
      agentLanguage: "ta-IN",
      languageAutoDetect: false,
    })).toMatchObject({ key: "ta", source: "agent" });
  });
});

describe("buildCallDirectionRule", () => {
  it("inbound with name + Tamil memory asks purpose of call", () => {
    const rule = buildCallDirectionRule({
      direction: "inbound",
      callerName: "Karthi",
      memoryLanguagePref: "ta",
      languageAutoDetect: true,
    });
    expect(rule).toContain("CALL DIRECTION — INBOUND");
    expect(rule).toContain("Karthi");
    expect(rule).toMatch(/என்ன விஷயமா|எதற்காக|என்ன காரணமா/);
    expect(rule).toContain("Tamil");
  });

  it("outbound forbids inbound purpose-of-call phrasing", () => {
    const rule = buildCallDirectionRule({
      direction: "outbound",
      callerName: "Karthi",
      memoryLanguagePref: "en",
    });
    expect(rule).toContain("CALL DIRECTION — OUTBOUND");
    expect(rule).toContain("YOU placed this call");
    expect(rule).toContain("என்ன விஷயமா கால் பண்ணிருக்கீங்க");
    expect(rule).toContain("Never ask why they called");
  });

  it("inbound English default when no memory language", () => {
    const rule = buildCallDirectionRule({
      direction: "inbound",
      callerName: null,
      memoryLanguagePref: null,
      languageAutoDetect: true,
    });
    expect(rule).toContain("English");
    expect(rule).toContain("What are you calling about");
  });
});

describe("resolveInboundGreetingTtsSpeed", () => {
  it("slows default pace for inbound openers", () => {
    expect(resolveInboundGreetingTtsSpeed(1)).toBe(0.85);
    expect(resolveInboundGreetingTtsSpeed(1.2)).toBe(1.02);
    expect(resolveInboundGreetingTtsSpeed(0.7)).toBe(0.7);
  });
});

describe("inboundPurposeExamples", () => {
  it("includes Tamil purpose phrase with name", () => {
    const examples = inboundPurposeExamples("ta", "சிவராம்");
    expect(examples.some((e) => e.includes("சிவராம்"))).toBe(true);
    expect(examples.some((e) => /விஷயமா|காரணமா/.test(e))).toBe(true);
  });

  it("offers several related Tamil inbound openers", () => {
    const examples = inboundPurposeExamples("ta", null);
    expect(examples.length).toBeGreaterThanOrEqual(4);
    expect(examples.some((e) => e.includes("என்ன விஷயமா கால் பண்ணிருக்கீங்க"))).toBe(true);
    expect(examples.some((e) => e.includes("எதற்காக கால் பண்ணிருக்கீங்க"))).toBe(true);
    expect(examples.some((e) => e.includes("என்ன காரணமா"))).toBe(true);
    expect(examples.every((e) => !/உதவலாம்|சேவைக்கு|விஷயத்துக்கு உதவி/.test(e))).toBe(true);
  });
});

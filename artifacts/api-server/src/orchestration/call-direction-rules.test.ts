import { describe, expect, it } from "vitest";
import {
  buildOpeningLanguageRule,
  languageDisplayName,
  mapLanguagePrefToBcp47,
  openingHello,
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

describe("mapLanguagePrefToBcp47", () => {
  it("maps stored memory codes and names (call 20257: ta stayed en-IN)", () => {
    expect(mapLanguagePrefToBcp47("ta")).toBe("ta-IN");
    expect(mapLanguagePrefToBcp47("tamil")).toBe("ta-IN");
    expect(mapLanguagePrefToBcp47("ta-IN")).toBe("ta-IN");
    expect(mapLanguagePrefToBcp47("hi")).toBe("hi-IN");
    expect(mapLanguagePrefToBcp47("english")).toBe("en-IN");
  });

  it("does not invent a language for empty memory", () => {
    expect(mapLanguagePrefToBcp47(null)).toBeUndefined();
    expect(mapLanguagePrefToBcp47("")).toBeUndefined();
  });
});

describe("languageDisplayName", () => {
  it("names Tamil from codes used on live handoff", () => {
    expect(languageDisplayName("ta")).toBe("Tamil");
    expect(languageDisplayName("ta-IN")).toBe("Tamil");
    expect(languageDisplayName("tamil")).toBe("Tamil");
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

  it("uses the STT language for multilingual when there is no memory", () => {
    expect(resolveCallOpeningLanguage({
      memoryLanguagePref: null,
      agentLanguage: "hi-IN",
      languageAutoDetect: true,
    })).toMatchObject({ key: "hi", source: "agent" });
    expect(resolveCallOpeningLanguage({
      memoryLanguagePref: null,
      agentLanguage: "ta-IN",
      languageAutoDetect: true,
    })).toMatchObject({ key: "ta", source: "agent" });
  });

  it("defaults to English when multilingual and no agent language", () => {
    expect(resolveCallOpeningLanguage({
      memoryLanguagePref: null,
      agentLanguage: null,
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

describe("buildOpeningLanguageRule", () => {
  it("states the opening language from memory and has no inbound/outbound script", () => {
    const rule = buildOpeningLanguageRule({
      memoryLanguagePref: "ta",
      languageAutoDetect: true,
    });
    expect(rule).toContain("[OPENING LANGUAGE]");
    expect(rule).toContain("Tamil");
    expect(rule).not.toContain("CALL DIRECTION");
    expect(rule).not.toMatch(/what they called|why they called|என்ன விஷயமா/);
  });
});

describe("openingHello", () => {
  it("returns a short hello in the opening language", () => {
    expect(openingHello("ta")).toBe("வணக்கம்");
    expect(openingHello("hi-IN")).toBe("नमस्ते");
    expect(openingHello("en")).toBe("Hi");
  });
});

describe("resolveInboundGreetingTtsSpeed", () => {
  it("slows default pace for inbound openers", () => {
    expect(resolveInboundGreetingTtsSpeed(1)).toBe(0.85);
    expect(resolveInboundGreetingTtsSpeed(1.2)).toBe(1.02);
    expect(resolveInboundGreetingTtsSpeed(0.7)).toBe(0.7);
  });
});

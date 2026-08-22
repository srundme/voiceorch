import { describe, expect, it } from "vitest";
import { firstVibeKickoff, looksLikeVibeBuild, shouldAutoOpenJarvis } from "./jarvis-vibe";

describe("looksLikeVibeBuild", () => {
  it("matches spoken create intents", () => {
    expect(looksLikeVibeBuild("Priya collection agent create pannu")).toBe(true);
    expect(looksLikeVibeBuild("Build a new inbound agent")).toBe(true);
    expect(looksLikeVibeBuild("I need a voice agent")).toBe(true);
  });

  it("leaves support questions on assistant chat", () => {
    expect(looksLikeVibeBuild("Why are my calls failing?")).toBe(false);
    expect(looksLikeVibeBuild("Wallet balance evlo irukku")).toBe(false);
  });
});

describe("firstVibeKickoff", () => {
  it("includes the signup name for the core-phase greeting", () => {
    expect(firstVibeKickoff("Karthik")).toContain("Karthik");
    expect(firstVibeKickoff("Karthik")).toContain("PHASE core");
  });
});

describe("shouldAutoOpenJarvis", () => {
  it("opens after signup query or session flag", () => {
    expect(shouldAutoOpenJarvis("?jarvis=1", null)).toBe(true);
    expect(shouldAutoOpenJarvis("", "1")).toBe(true);
    expect(shouldAutoOpenJarvis("", null)).toBe(false);
  });
});

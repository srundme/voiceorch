import { describe, expect, it } from "vitest";
import { buildInstantReturningGreeting, neutralGreeting } from "./endpointing.js";

describe("buildInstantReturningGreeting", () => {
  it("builds Hindi recognition opener with name", () => {
    expect(buildInstantReturningGreeting("Thirumugam", "hi-IN")).toContain("Thirumugam");
    expect(buildInstantReturningGreeting("Thirumugam", "hi-IN")).toMatch(/^नमस्ते/);
  });

  it("builds Tamil opener with name", () => {
    expect(buildInstantReturningGreeting("Karthik", "ta")).toContain("Karthik");
    expect(buildInstantReturningGreeting("Karthik", "ta")).toMatch(/^வணக்கம்/);
    expect(buildInstantReturningGreeting("Karthik", "ta")).toContain("எப்படி இருக்கீங்க");
  });

  it("falls back without name", () => {
    expect(buildInstantReturningGreeting(null, "en")).toBe("Hi! How are you?");
    expect(buildInstantReturningGreeting("", "hi")).toBe("नमस्ते! कैसे हैं आप?");
  });
});

describe("neutralGreeting", () => {
  it("returns language-specific opener", () => {
    expect(neutralGreeting("ta-IN")).toContain("வணக்கம்");
  });
});

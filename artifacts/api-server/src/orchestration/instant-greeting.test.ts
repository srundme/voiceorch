import { describe, expect, it } from "vitest";
import {
  buildInstantReturningGreeting,
  neutralGreeting,
  isMetaRefusalGreeting,
} from "./endpointing.js";

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

describe("isMetaRefusalGreeting", () => {
  it("rejects the call 9153 opener that was spoken to a lead", () => {
    expect(
      isMetaRefusalGreeting(
        "Since no CALL FLOW or GREETING was provided in the prompt, I am unable to start the call. Please provide the script and flow.",
      ),
    ).toBe(true);
  });

  it("rejects other meta / refusal shapes", () => {
    expect(isMetaRefusalGreeting("I cannot begin without a script.")).toBe(true);
    expect(isMetaRefusalGreeting("As an AI, I need more context first.")).toBe(true);
    expect(isMetaRefusalGreeting("No greeting was provided, so I will wait.")).toBe(true);
    expect(isMetaRefusalGreeting("The system prompt does not define an opener.")).toBe(true);
  });

  it("accepts genuine openers", () => {
    expect(
      isMetaRefusalGreeting("Hi, this is Robert from Casagrand Aquagrove. Am I speaking with Rajavarthini A?"),
    ).toBe(false);
    expect(isMetaRefusalGreeting("Hello! We're calling from SnapServe regarding the Voice-a-thon.")).toBe(false);
    expect(isMetaRefusalGreeting("வணக்கம், நான் ராபர்ட் பேசுறேன்.")).toBe(false);
  });

  it("treats empty text as not a refusal so the caller path still applies", () => {
    expect(isMetaRefusalGreeting("")).toBe(false);
    expect(isMetaRefusalGreeting(null)).toBe(false);
  });
});

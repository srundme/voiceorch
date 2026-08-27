import { describe, expect, it } from "vitest";
import {
  buildInstantReturningGreeting,
  neutralGreeting,
  isMetaRefusalGreeting,
} from "./endpointing.js";

describe("buildInstantReturningGreeting", () => {
  it("builds Hindi purpose-of-call opener with name", () => {
    const g = buildInstantReturningGreeting("Thirumugam", "hi-IN");
    expect(g).toContain("Thirumugam");
    expect(g).toMatch(/^नमस्ते/);
    expect(g).not.toMatch(/कैसे हैं आप/);
  });

  it("builds Tamil purpose-of-call opener with name (not how-are-you)", () => {
    const g = buildInstantReturningGreeting("Karthik", "ta");
    expect(g).toContain("Karthik");
    expect(g).toMatch(/^வணக்கம்/);
    expect(g).toMatch(/விஷயமா|எதற்காக|காரணமா/);
    expect(g).not.toContain("எப்படி இருக்கீங்க");
  });

  it("falls back without name — asks why they called, not how are you", () => {
    expect(buildInstantReturningGreeting(null, "en")).toBe("Hi, what are you calling about?");
    expect(buildInstantReturningGreeting("", "hi")).toMatch(/किस बारे में कॉल|किस विषय/);
    expect(buildInstantReturningGreeting(null, "en")).not.toMatch(/how are you/i);
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

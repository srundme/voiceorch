import { describe, expect, it } from "vitest";
import { detectScreeningPrompt, isScreeningHoldFragment, SCREENING_HOLD_HANGUP_MS } from "./callScreening.js";

describe("detectScreeningPrompt", () => {
  it("matches iPhone Ask Reason for Calling (call 15619)", () => {
    expect(detectScreeningPrompt(
      "Please state your name and reason for calling.",
    )).toBe(true);
    expect(detectScreeningPrompt(
      "The person you are calling would like to know who's calling. Please say your name and why you're calling.",
    )).toBe(true);
    expect(detectScreeningPrompt(
      "This is iPhone Call Screening. Leave your name and the reason for calling.",
    )).toBe(true);
  });

  it("matches Google Call Screen", () => {
    expect(detectScreeningPrompt(
      "Google's Call Screen. The person you're calling isn't available. This call is being screened.",
    )).toBe(true);
  });

  it("matches iPhone Live Voicemail (call 16959)", () => {
    expect(detectScreeningPrompt(
      "Hi, if you record your name and reason for calling, I'll see if this person is available.",
    )).toBe(true);
    expect(detectScreeningPrompt("Thanks, Gopi. Please stay on the line.")).toBe(true);
    expect(detectScreeningPrompt(
      "I'm sorry, this person is not available. If you would like to leave an additional message, please reply after the tone.",
    )).toBe(true);
  });

  it("does not treat a real human as a screener", () => {
    expect(detectScreeningPrompt("Hello, who is this?")).toBe(false);
    expect(detectScreeningPrompt("Why are you calling?")).toBe(false);
    expect(detectScreeningPrompt("Hi")).toBe(false);
    expect(detectScreeningPrompt("Thanks")).toBe(false);
  });

  it("matches classic voicemail greetings as voicemail too", () => {
    expect(detectScreeningPrompt("Please leave a message after the beep.")).toBe(true);
    expect(detectScreeningPrompt("You have reached the voicemail of Gopi.")).toBe(true);
  });
});

describe("isScreeningHoldFragment", () => {
  it("holds the iPhone 'Thanks' stub so we do not pitch it as a human", () => {
    expect(isScreeningHoldFragment("Thanks")).toBe(true);
    expect(isScreeningHoldFragment("thank you")).toBe(true);
    expect(isScreeningHoldFragment("yes please")).toBe(false);
    expect(SCREENING_HOLD_HANGUP_MS).toBe(2_500);
  });
});

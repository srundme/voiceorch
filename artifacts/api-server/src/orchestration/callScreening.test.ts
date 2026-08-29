import { describe, expect, it } from "vitest";
import { detectScreeningPrompt } from "./callScreening.js";

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

  it("does not treat a real human as a screener", () => {
    expect(detectScreeningPrompt("Hello, who is this?")).toBe(false);
    expect(detectScreeningPrompt("Why are you calling?")).toBe(false);
    expect(detectScreeningPrompt("Hi")).toBe(false);
  });
});

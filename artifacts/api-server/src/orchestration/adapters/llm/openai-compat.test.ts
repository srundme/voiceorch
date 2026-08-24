import { describe, expect, it } from "vitest";
import { looksLikeFunctionCallNotation } from "./openai-compat.js";

describe("looksLikeFunctionCallNotation", () => {
  const tools = new Set(["book_appointment", "check_availability"]);

  it("does not stall TTS on a spoken mention of a tool name", () => {
    expect(looksLikeFunctionCallNotation("I can check_availability for you tomorrow.", tools)).toBe(false);
  });

  it("detects an inline function-call envelope", () => {
    expect(looksLikeFunctionCallNotation("check_availability(date=\"tomorrow\")", tools)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { isCartesiaVoiceId, looksLikeKarthikeyan } from "./assistant-voice.js";

describe("looksLikeKarthikeyan", () => {
  it("matches admin and clone labels", () => {
    expect(looksLikeKarthikeyan("Karthikeyan")).toBe(true);
    expect(looksLikeKarthikeyan("Karthikeyan clone")).toBe(true);
    expect(looksLikeKarthikeyan("KARTHIKEYAN")).toBe(true);
    expect(looksLikeKarthikeyan("Priya")).toBe(false);
  });
});

describe("isCartesiaVoiceId", () => {
  it("accepts Cartesia UUIDs only", () => {
    expect(isCartesiaVoiceId("a0e99841-438c-4a64-b679-ae501e7d6091")).toBe(true);
    expect(isCartesiaVoiceId("priya")).toBe(false);
  });
});

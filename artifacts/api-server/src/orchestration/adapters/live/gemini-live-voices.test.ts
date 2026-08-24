import { describe, expect, it } from "vitest";
import {
  DEFAULT_GEMINI_LIVE_MODEL,
  DEFAULT_GEMINI_LIVE_VOICE,
  GEMINI_LIVE_VOICES,
  isValidGeminiLiveVoice,
  resolveGeminiLiveModel,
  resolveGeminiLiveVoice,
  resolveVoiceStack,
} from "./gemini-live-voices.js";

describe("gemini-live-voices", () => {
  it("exposes 30 preset voices", () => {
    expect(GEMINI_LIVE_VOICES).toHaveLength(30);
  });

  it("defaults to Kore", () => {
    expect(resolveGeminiLiveVoice(undefined)).toBe(DEFAULT_GEMINI_LIVE_VOICE);
    expect(resolveGeminiLiveVoice("NotAVoice")).toBe(DEFAULT_GEMINI_LIVE_VOICE);
    expect(isValidGeminiLiveVoice("Kore")).toBe(true);
  });

  it("resolves voice stack safely", () => {
    expect(resolveVoiceStack(undefined)).toBe("classic");
    expect(resolveVoiceStack("classic")).toBe("classic");
    expect(resolveVoiceStack("gemini_live")).toBe("gemini_live");
    expect(resolveVoiceStack("other")).toBe("classic");
  });

  it("remaps deprecated Live models onto the current voice-agent id", () => {
    expect(resolveGeminiLiveModel(undefined)).toBe(DEFAULT_GEMINI_LIVE_MODEL);
    expect(resolveGeminiLiveModel("gemini-2.5-flash-native-audio-preview-12-2025")).toBe(DEFAULT_GEMINI_LIVE_MODEL);
    expect(resolveGeminiLiveModel("gemini-3.1-flash-live-preview")).toBe("gemini-3.1-flash-live-preview");
  });
});

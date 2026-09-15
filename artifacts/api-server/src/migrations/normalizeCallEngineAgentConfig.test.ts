import { describe, expect, it } from "vitest";
import { normalizeCallEngineAgentConfig } from "../../../../lib/db/src/call-engine-defaults.js";

describe("normalizeCallEngineAgentConfig — Saaras-native Sarvam defaults", () => {
  it("rewrites legacy patient Sarvam STT defaults to Saaras-native", () => {
    const result = normalizeCallEngineAgentConfig({
      sarvamHighVadSensitivity: false,
      sarvamSpeechEndFlushMs: 80,
      sarvamIncompleteHoldMs: 700,
      fragmentCoalesceListeningMs: 250,
      fragmentCoalescePlayingMs: 1000,
    });
    expect(result.changed).toBe(true);
    expect(result.config.sarvamHighVadSensitivity).toBe(true);
    expect(result.config.sarvamSpeechEndFlushMs).toBe(0);
    expect(result.config.sarvamIncompleteHoldMs).toBe(0);
    expect(result.config.fragmentCoalesceListeningMs).toBe(0);
    expect(result.config.fragmentCoalescePlayingMs).toBe(0);
  });

  it("rewrites legacy snappy incomplete-hold profile to Saaras-native", () => {
    const result = normalizeCallEngineAgentConfig({
      sarvamHighVadSensitivity: true,
      sarvamSpeechEndFlushMs: 30,
      sarvamIncompleteHoldMs: 220,
      fragmentCoalesceListeningMs: 150,
      fragmentCoalescePlayingMs: 800,
    });
    expect(result.changed).toBe(true);
    expect(result.config.sarvamIncompleteHoldMs).toBe(0);
    expect(result.config.sarvamSpeechEndFlushMs).toBe(0);
    expect(result.config.fragmentCoalesceListeningMs).toBe(0);
    expect(result.config.fragmentCoalescePlayingMs).toBe(0);
  });

  it("leaves intentional custom Sarvam holds alone", () => {
    const input = {
      sarvamHighVadSensitivity: true,
      sarvamSpeechEndFlushMs: 50,
      sarvamIncompleteHoldMs: 500,
    };
    expect(normalizeCallEngineAgentConfig(input).changed).toBe(false);
  });

  it("rewrites platform speaking waits and TTS clause gate to trust-provider defaults", () => {
    const result = normalizeCallEngineAgentConfig({
      startSpeakingPlan: {
        waitSeconds: 0,
        onPunctuationSeconds: 0.1,
        onNoPunctuationSeconds: 1.5,
        onNumberSeconds: 0.5,
      },
      ttsMinSentenceChars: 18,
    });
    expect(result.changed).toBe(true);
    expect(result.config.startSpeakingPlan).toEqual({
      waitSeconds: 0,
      onPunctuationSeconds: 0,
      onNoPunctuationSeconds: 0,
      onNumberSeconds: 0,
    });
    expect(result.config.ttsMinSentenceChars).toBe(5);
  });

  it("leaves intentional custom speaking / TTS thresholds alone", () => {
    const input = {
      sarvamHighVadSensitivity: true,
      sarvamSpeechEndFlushMs: 0,
      sarvamIncompleteHoldMs: 0,
      startSpeakingPlan: {
        waitSeconds: 0,
        onPunctuationSeconds: 0.3,
        onNoPunctuationSeconds: 0.4,
        onNumberSeconds: 0.6,
      },
      ttsMinSentenceChars: 30,
    };
    expect(normalizeCallEngineAgentConfig(input).changed).toBe(false);
  });

  it.each([300, 500])("preserves explicit %i ms Saaras endpointing", (ms) => {
    const result = normalizeCallEngineAgentConfig({
      sarvamEndOfSpeechSilenceMs: ms,
    });
    expect(result.config.sarvamEndOfSpeechSilenceMs).toBe(ms);
    expect(result.reasons.some((reason) => reason.includes("sarvamEndOfSpeechSilenceMs"))).toBe(false);
  });

  it("leaves an intentional Patient 700ms EOS in place", () => {
    expect(normalizeCallEngineAgentConfig({ sarvamEndOfSpeechSilenceMs: 700 }).config.sarvamEndOfSpeechSilenceMs).toBe(700);
  });
});

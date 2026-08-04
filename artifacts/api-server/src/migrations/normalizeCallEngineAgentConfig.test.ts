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
});

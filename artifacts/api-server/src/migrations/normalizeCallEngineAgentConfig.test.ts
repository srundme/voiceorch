import { describe, it, expect } from "vitest";
import {
  normalizeCallEngineAgentConfig,
  callEngineInsertDefaults,
  voiceSecondsFromInterruptWords,
} from "@workspace/db/call-engine-defaults";

describe("normalizeCallEngineAgentConfig", () => {
  it("is a no-op for already-safe Balanced defaults", () => {
    const input = {
      bargeInEnergyThreshold: 1200,
      asrEndpointingSilenceMs: 250,
      wordsForInterruption: 3,
      stopSpeakingPlan: { numWords: 3, voiceSeconds: 0.45, backOffSeconds: 1 },
      incrementalDelay: 0,
    };
    const result = normalizeCallEngineAgentConfig(input);
    expect(result.changed).toBe(false);
    expect(result.config).toEqual(input);
  });

  it("rewrites legacy latency footguns (350ms delay, 1.5s no-punct)", () => {
    const result = normalizeCallEngineAgentConfig({
      incrementalDelay: 350,
      startSpeakingPlan: {
        waitSeconds: 0,
        onPunctuationSeconds: 0.1,
        onNoPunctuationSeconds: 1.5,
        onNumberSeconds: 0.5,
      },
    });
    expect(result.changed).toBe(true);
    expect(result.config.incrementalDelay).toBe(0);
    expect((result.config.startSpeakingPlan as Record<string, number>).onNoPunctuationSeconds).toBe(0.1);
    expect((result.config.startSpeakingPlan as Record<string, number>).onNumberSeconds).toBe(0.1);
  });

  it("rewrites energy 200, endpoint 50, words 0, voice 0.06 (call 2620 profile)", () => {
    const result = normalizeCallEngineAgentConfig({
      bargeInEnergyThreshold: 200,
      asrEndpointingSilenceMs: 50,
      wordsForInterruption: 0,
      stopSpeakingPlan: { numWords: 0, voiceSeconds: 0.06, backOffSeconds: 1 },
    });
    expect(result.changed).toBe(true);
    expect(result.config.bargeInEnergyThreshold).toBe(1200);
    expect(result.config.asrEndpointingSilenceMs).toBe(250);
    expect(result.config.wordsForInterruption).toBe(3);
    expect(result.config.stopSpeakingPlan).toEqual({
      numWords: 3,
      voiceSeconds: 0.45,
      backOffSeconds: 1,
    });
  });

  it("raises voice when words are already positive", () => {
    const result = normalizeCallEngineAgentConfig({
      wordsForInterruption: 2,
      stopSpeakingPlan: { numWords: 2, voiceSeconds: 0.06, backOffSeconds: 1 },
    });
    expect(result.changed).toBe(true);
    expect(result.config.wordsForInterruption).toBe(2);
    expect(result.config.stopSpeakingPlan).toEqual({
      numWords: 2,
      voiceSeconds: voiceSecondsFromInterruptWords(2),
      backOffSeconds: 1,
    });
  });

  it("leaves Fast preset endpoint 150 and energy 900 alone", () => {
    const input = {
      bargeInEnergyThreshold: 900,
      asrEndpointingSilenceMs: 150,
      wordsForInterruption: 2,
      stopSpeakingPlan: { numWords: 2, voiceSeconds: 0.3, backOffSeconds: 1 },
    };
    expect(normalizeCallEngineAgentConfig(input).changed).toBe(false);
  });

  it("callEngineInsertDefaults matches Bolna safe floors", () => {
    expect(callEngineInsertDefaults()).toEqual({
      asrEndpointingSilenceMs: 250,
      incrementalDelay: 0,
      bargeInEnergyThreshold: 1200,
      wordsForInterruption: 3,
      startSpeakingPlan: {
        waitSeconds: 0,
        onPunctuationSeconds: 0.1,
        onNoPunctuationSeconds: 0.1,
        onNumberSeconds: 0.1,
      },
      fragmentCoalesceListeningMs: 150,
      fragmentCoalescePlayingMs: 800,
      telephonyTailDrainMs: 400,
      sarvamHighVadSensitivity: true,
      sarvamSpeechEndFlushMs: 30,
      sarvamIncompleteHoldMs: 220,
      stopSpeakingPlan: { numWords: 3, voiceSeconds: 0.45, backOffSeconds: 1 },
    });
  });
});

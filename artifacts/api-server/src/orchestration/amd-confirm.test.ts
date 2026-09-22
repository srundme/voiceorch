import { describe, expect, it } from "vitest";
import {
  isHumanShortUtterancePause,
  isLikelyRingBurstPattern,
} from "./amd-confirm.js";

describe("isLikelyRingBurstPattern", () => {
  it("flags multi short bursts as ring (QA 28294 / 28406)", () => {
    expect(isLikelyRingBurstPattern({ speechBurstCount: 2, maxContinuousMs: 400 })).toBe(true);
    expect(isLikelyRingBurstPattern({ speechBurstCount: 3, maxContinuousMs: 700 })).toBe(true);
  });

  it("does not flag a single hello burst", () => {
    expect(isLikelyRingBurstPattern({ speechBurstCount: 1, maxContinuousMs: 500 })).toBe(false);
  });

  it("does not flag a long VM monologue run", () => {
    expect(isLikelyRingBurstPattern({ speechBurstCount: 2, maxContinuousMs: 2000 })).toBe(false);
  });
});

describe("isHumanShortUtterancePause", () => {
  it("accepts one short hello then pause", () => {
    expect(
      isHumanShortUtterancePause({
        heardSpeech: true,
        currentlyInSpeechRun: false,
        speechBurstCount: 1,
        maxContinuousMs: 450,
        continuousBarMs: 1600,
        sinceSpeechMs: 600,
        humanPauseMs: 500,
      }),
    ).toBe(true);
  });

  it("rejects ring cadence (multiple short bursts)", () => {
    expect(
      isHumanShortUtterancePause({
        heardSpeech: true,
        currentlyInSpeechRun: false,
        speechBurstCount: 3,
        maxContinuousMs: 350,
        continuousBarMs: 1600,
        sinceSpeechMs: 800,
        humanPauseMs: 500,
      }),
    ).toBe(false);
  });
});

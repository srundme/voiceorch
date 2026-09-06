import { describe, expect, it } from "vitest";
import {
  getMicSensitivityThresholds,
  isBackgroundTalkerUtterance,
  isIdleCancellingMicEnergy,
  LEGACY_NORMAL_BARGE_IN_ENERGY,
  resolveBargeInEnergyThreshold,
  resolveMicSensitivity,
} from "./mic-sensitivity.js";

describe("resolveMicSensitivity — product default Low for all", () => {
  it("always returns low (not exposed in Builder)", () => {
    expect(resolveMicSensitivity(undefined)).toBe("low");
    expect(resolveMicSensitivity("normal")).toBe("low");
    expect(resolveMicSensitivity("high")).toBe("low");
    expect(resolveMicSensitivity("low")).toBe("low");
  });
});

describe("resolveBargeInEnergyThreshold", () => {
  const lowBar = getMicSensitivityThresholds("low").bargeInEnergyThreshold;

  it("uses Low bar when unset", () => {
    expect(resolveBargeInEnergyThreshold(undefined)).toBe(lowBar);
    expect(resolveBargeInEnergyThreshold(null)).toBe(lowBar);
  });

  it("rewrites legacy Normal 1200 to Low so existing agents upgrade without re-save", () => {
    expect(LEGACY_NORMAL_BARGE_IN_ENERGY).toBe(1200);
    expect(resolveBargeInEnergyThreshold(1200)).toBe(lowBar);
    expect(lowBar).toBe(1800);
  });

  it("honours a non-legacy explicit override", () => {
    expect(resolveBargeInEnergyThreshold(2500)).toBe(2500);
    expect(resolveBargeInEnergyThreshold(900)).toBe(900);
  });
});

describe("isBackgroundTalkerUtterance", () => {
  it("does not drop when RMS was not measured", () => {
    expect(isBackgroundTalkerUtterance(0)).toBe(false);
  });

  it("drops a quiet far-field talker and keeps a near-mic caller", () => {
    expect(isBackgroundTalkerUtterance(400)).toBe(true);
    expect(isBackgroundTalkerUtterance(2500)).toBe(false);
  });
});

describe("isIdleCancellingMicEnergy", () => {
  it("ignores echo-grace and sub-floor energy so idle can fire after TTS (call 14315)", () => {
    expect(isIdleCancellingMicEnergy({ hasSpeech: true, rawRms: 2500, inEchoGrace: true })).toBe(false);
    expect(isIdleCancellingMicEnergy({ hasSpeech: true, rawRms: 200, inEchoGrace: false })).toBe(false);
    expect(isIdleCancellingMicEnergy({ hasSpeech: false, rawRms: 2500, inEchoGrace: false })).toBe(false);
  });

  it("counts a near-talker frame once echo grace has ended", () => {
    expect(isIdleCancellingMicEnergy({ hasSpeech: true, rawRms: 1200, inEchoGrace: false })).toBe(true);
  });
});

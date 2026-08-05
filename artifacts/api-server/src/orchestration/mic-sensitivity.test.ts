import { describe, expect, it } from "vitest";
import {
  getMicSensitivityThresholds,
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

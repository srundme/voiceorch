import { describe, expect, it } from "vitest";
import { NoiseCanceller, telephonyBandpass } from "./audio.js";

function tone(hz: number, count = 8000): Int16Array {
  return Int16Array.from({ length: count }, (_, i) => Math.round(4000 * Math.sin(2 * Math.PI * hz * i / 8000)));
}

function energy(samples: Int16Array): number {
  const stable = samples.subarray(800); // exclude filter start-up
  return Math.sqrt(stable.reduce((sum, x) => sum + x * x, 0) / stable.length);
}

describe("telephony bandpass", () => {
  it.each([500, 800, 1000, 2000, 3000])("preserves %i Hz speech without resonant amplification", (hz) => {
    const input = tone(hz);
    const gain = energy(telephonyBandpass(input)) / energy(input);
    expect(gain).toBeGreaterThan(0.85);
    expect(gain).toBeLessThanOrEqual(1.01);
  });

  it.each([50, 100, 3900])("suppresses out-of-band %i Hz noise", (hz) => {
    const input = tone(hz);
    expect(energy(telephonyBandpass(input)) / energy(input)).toBeLessThan(0.12);
  });

  it.each([300, 3400])("has approximately -3 dB gain at the %i Hz cutoff", (hz) => {
    const input = tone(hz);
    const gain = energy(telephonyBandpass(input)) / energy(input);
    expect(gain).toBeGreaterThan(0.69);
    expect(gain).toBeLessThan(0.72);
  });

  it("keeps filter state continuous between 20 ms input frames", () => {
    const input = tone(1300, 3200);
    const expected = telephonyBandpass(input);
    const nc = new NoiseCanceller(); // stays in calibration for these 20 frames
    const output: Buffer[] = [];
    const bytes = Buffer.from(input.buffer);
    for (let i = 0; i < bytes.length; i += 320) output.push(nc.process(bytes.subarray(i, i + 320)));
    expect(Buffer.concat(output)).toEqual(Buffer.from(expected.buffer));
  });
});

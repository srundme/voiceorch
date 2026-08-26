import { describe, expect, it } from "vitest";
import { naiveRfftPower, rfftPower } from "./smart-turn-fft.js";
import { computeWhisperLogMelFeatures, SMART_TURN_N_FRAMES, SMART_TURN_N_MELS } from "./smart-turn-mel.js";

function maxRelErr(a: Float64Array, b: Float64Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const denom = Math.max(1e-12, Math.abs(b[i]!));
    m = Math.max(m, Math.abs(a[i]! - b[i]!) / denom);
  }
  return m;
}

describe("rfftPower", () => {
  it("matches a naive DFT on a 16-sample impulse", () => {
    const x = new Float64Array(16);
    x[0] = 1;
    const a = rfftPower(x);
    const b = naiveRfftPower(x);
    expect(maxRelErr(a, b)).toBeLessThan(1e-9);
  });

  it("matches a naive DFT on a 400-sample sine (Bluestein path)", () => {
    const x = new Float64Array(400);
    for (let i = 0; i < 400; i++) x[i] = Math.sin((2 * Math.PI * 7 * i) / 400);
    const a = rfftPower(x);
    const b = naiveRfftPower(x);
    expect(maxRelErr(a, b)).toBeLessThan(1e-6);
  });
});

describe("computeWhisperLogMelFeatures", () => {
  it("returns an 80×800 feature map for any input length", () => {
    const audio = new Float32Array(16000);
    for (let i = 0; i < audio.length; i++) audio[i] = Math.sin((2 * Math.PI * 220 * i) / 16000) * 0.2;
    const feat = computeWhisperLogMelFeatures(audio);
    expect(feat.length).toBe(SMART_TURN_N_MELS * SMART_TURN_N_FRAMES);
    let finite = 0;
    for (let i = 0; i < feat.length; i++) if (Number.isFinite(feat[i]!)) finite++;
    expect(finite).toBe(feat.length);
  });
});

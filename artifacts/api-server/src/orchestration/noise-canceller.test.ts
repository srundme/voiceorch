import { describe, it, expect } from "vitest";
import { NoiseCanceller } from "./audio.js";

// 20 ms @ 8 kHz = 160 samples = 320 bytes
const FRAME_SAMPLES = 160;
const CALIB_FRAMES = 25;

/** Build one 20 ms PCM frame: a sine burst at the given peak amplitude. */
function frame(peak: number, freqHz = 500): Buffer {
  const buf = Buffer.allocUnsafe(FRAME_SAMPLES * 2);
  for (let i = 0; i < FRAME_SAMPLES; i++) {
    const s = Math.round(peak * Math.sin((2 * Math.PI * freqHz * i) / 8000));
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, s)), i * 2);
  }
  return buf;
}

function rmsOf(buf: Buffer): number {
  let sum = 0;
  const n = buf.length / 2;
  for (let i = 0; i < n; i++) {
    const s = buf.readInt16LE(i * 2) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

/** Run the calibration phase with quiet ambient noise, return the canceller. */
function calibrated(ambientPeak = 200): NoiseCanceller {
  const nc = new NoiseCanceller();
  for (let i = 0; i < CALIB_FRAMES; i++) nc.process(frame(ambientPeak));
  return nc;
}

describe("NoiseCanceller adaptive gate (call 2039 — one-word replies erased)", () => {
  it("attenuates below-threshold frames instead of hard-zeroing them", () => {
    const nc = calibrated(200);
    // A frame at ambient level is below noiseFloor × GATE_RATIO → gated.
    const out = nc.process(frame(200));
    const outRms = rmsOf(out);
    // NOT pure digital silence…
    expect(outRms).toBeGreaterThan(0);
    // …but clearly suppressed relative to the input passband energy.
    const passthrough = rmsOf(calibrated(200).process(frame(200 * 100))); // loud speech passes
    expect(outRms).toBeLessThan(passthrough * 0.1);
  });

  it("passes loud speech frames through unmodified (post-bandpass)", () => {
    const nc = calibrated(200);
    const out = nc.process(frame(20000));
    // Loud in-band speech survives with substantial energy.
    expect(rmsOf(out)).toBeGreaterThan(0.05);
  });

  it("holds the gate open (hangover) for quiet frames right after speech", () => {
    const nc = calibrated(200);
    nc.process(frame(20000)); // speech frame → arms hangover
    // Immediately-following quiet frame is inside the hangover window →
    // passed through un-attenuated (identical to a fresh calibration passthrough).
    const afterSpeech = nc.process(frame(200));
    // Compare with a canceller that saw NO speech: same quiet frame is attenuated.
    const nc2 = calibrated(200);
    const noSpeech = nc2.process(frame(200));
    expect(rmsOf(afterSpeech)).toBeGreaterThan(rmsOf(noSpeech) * 3);
  });

  it("closes the gate again after the hangover window elapses", () => {
    const nc = calibrated(200);
    nc.process(frame(20000)); // speech → 5-frame hangover
    // First quiet frame after speech: inside hangover → passed through.
    const inHangover = nc.process(frame(200));
    for (let i = 0; i < 4; i++) nc.process(frame(200)); // consume rest of hangover
    const afterHangover = nc.process(frame(200)); // 6th quiet frame → gated again
    // Gate is closed again: clearly attenuated versus the hangover passthrough,
    // but still not pure silence.
    expect(rmsOf(afterHangover)).toBeLessThan(rmsOf(inHangover) * 0.5);
    expect(rmsOf(afterHangover)).toBeGreaterThan(0);
  });

  it("keeps a short soft utterance audible end-to-end (the one-word 'yes' case)", () => {
    const nc = calibrated(200);
    // Soft-but-real speech: 8× ambient — above the 4× gate threshold.
    const soft = nc.process(frame(1600));
    expect(rmsOf(soft)).toBeGreaterThan(0.001);
    // The trailing quieter tail of the word (inside hangover) also survives.
    const tail = nc.process(frame(400));
    expect(rmsOf(tail)).toBeGreaterThan(0.0005);
  });
});

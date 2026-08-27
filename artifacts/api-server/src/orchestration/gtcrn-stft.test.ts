import { describe, expect, it } from "vitest";
import { GTCRN_HOP, GtcrnIstft, GtcrnStft } from "./gtcrn-stft.js";

function sine16k(samples: number, hz = 440, amp = 0.4): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * hz * i) / 16000);
  }
  return out;
}

describe("GTCRN STFT/iSTFT", () => {
  it("round-trips a sine after the n_fft/2 analysis delay", () => {
    const src = sine16k(16000);
    const stft = new GtcrnStft();
    const istft = new GtcrnIstft();
    const hops: Float32Array[] = [];
    for (const frame of stft.push(src)) {
      hops.push(istft.push(frame.re, frame.im));
    }
    const out = new Float32Array(hops.reduce((n, h) => n + h.length, 0));
    let o = 0;
    for (const h of hops) {
      out.set(h, o);
      o += h.length;
    }
    // center pad delays reconstruction by one hop
    const aligned = out.subarray(GTCRN_HOP);
    const n = Math.min(8000, aligned.length);
    let err = 0;
    for (let i = 0; i < n; i++) err += Math.abs(aligned[i]! - src[i]!);
    expect(err / n).toBeLessThan(0.05);
  });
});

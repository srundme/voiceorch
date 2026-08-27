/**
 * Streaming STFT / iSTFT for GTCRN (n_fft=512, hop=256, sqrt-Hann).
 * Matches Xiaobin-Rong/gtcrn + sherpa-onnx: window = sqrt(numpy.hanning(512)).
 *
 * Analysis uses a one-time n_fft/2 zero pad (torch.stft center=True constant pad)
 * so the first hop is 16 ms @ 16 kHz — fine for telephony.
 */

import { fftRadix2 } from "./smart-turn-fft.js";

export const GTCRN_N_FFT = 512;
export const GTCRN_HOP = 256;
export const GTCRN_BINS = 257; // n_fft/2 + 1

function numpyHanning(n: number): Float64Array {
  const w = new Float64Array(n);
  if (n === 1) {
    w[0] = 1;
    return w;
  }
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  }
  return w;
}

const SQRT_HANN = (() => {
  const h = numpyHanning(GTCRN_N_FFT);
  const out = new Float64Array(GTCRN_N_FFT);
  for (let i = 0; i < GTCRN_N_FFT; i++) out[i] = Math.sqrt(h[i]!);
  return out;
})();

export function gtcrnAnalysisWindow(): Float64Array {
  return SQRT_HANN;
}

export class GtcrnStft {
  private buf = new Float32Array(0);
  private primed = false;

  push(samples: Float32Array): Array<{ re: Float32Array; im: Float32Array }> {
    if (!this.primed) {
      const pad = new Float32Array(GTCRN_HOP + samples.length);
      pad.set(samples, GTCRN_HOP);
      this.buf = pad;
      this.primed = true;
    } else if (samples.length) {
      const next = new Float32Array(this.buf.length + samples.length);
      next.set(this.buf);
      next.set(samples, this.buf.length);
      this.buf = next;
    }

    const frames: Array<{ re: Float32Array; im: Float32Array }> = [];
    while (this.buf.length >= GTCRN_N_FFT) {
      frames.push(this.analyse(this.buf.subarray(0, GTCRN_N_FFT)));
      this.buf = this.buf.slice(GTCRN_HOP);
    }
    return frames;
  }

  private analyse(frame: Float32Array): { re: Float32Array; im: Float32Array } {
    const re = new Float64Array(GTCRN_N_FFT);
    const im = new Float64Array(GTCRN_N_FFT);
    for (let i = 0; i < GTCRN_N_FFT; i++) {
      re[i] = frame[i]! * SQRT_HANN[i]!;
    }
    fftRadix2(re, im, false);
    const outRe = new Float32Array(GTCRN_BINS);
    const outIm = new Float32Array(GTCRN_BINS);
    for (let k = 0; k < GTCRN_BINS; k++) {
      outRe[k] = re[k]!;
      outIm[k] = im[k]!;
    }
    return { re: outRe, im: outIm };
  }
}

export class GtcrnIstft {
  private ola = new Float64Array(GTCRN_N_FFT);

  push(re: ArrayLike<number>, im: ArrayLike<number>): Float32Array {
    const tRe = new Float64Array(GTCRN_N_FFT);
    const tIm = new Float64Array(GTCRN_N_FFT);
    for (let k = 0; k < GTCRN_BINS; k++) {
      tRe[k] = re[k]!;
      tIm[k] = im[k]!;
    }
    for (let k = 1; k < GTCRN_BINS - 1; k++) {
      tRe[GTCRN_N_FFT - k] = re[k]!;
      tIm[GTCRN_N_FFT - k] = -(im[k]!);
    }
    fftRadix2(tRe, tIm, true);

    const hop = new Float32Array(GTCRN_HOP);
    for (let i = 0; i < GTCRN_N_FFT; i++) {
      this.ola[i]! += tRe[i]! * SQRT_HANN[i]!;
    }
    for (let i = 0; i < GTCRN_HOP; i++) hop[i] = this.ola[i]!;
    this.ola.copyWithin(0, GTCRN_HOP);
    this.ola.fill(0, GTCRN_HOP);
    return hop;
  }
}

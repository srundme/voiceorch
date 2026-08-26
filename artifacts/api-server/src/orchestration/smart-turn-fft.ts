/**
 * Real FFT helpers for Whisper-style log-mel (Smart Turn v3).
 * n=400 frames use Bluestein's chirp-z so we match numpy.fft.rfft, not a
 * padded-to-512 approximation that would desync the ONNX classifier.
 */

/** In-place Cooley–Tukey radix-2 FFT. n must be a power of two. inverse: conjugate + scale. */
export function fftRadix2(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (n !== im.length || (n & (n - 1)) !== 0) {
    throw new Error(`fftRadix2 requires power-of-two length, got ${n}`);
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!; const ti = im[i]!;
      re[i] = re[j]!; im[i] = im[j]!;
      re[j] = tr; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j]!;
        const uIm = im[i + j]!;
        const vRe = re[i + j + half]! * wRe - im[i + j + half]! * wIm;
        const vIm = re[i + j + half]! * wIm + im[i + j + half]! * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
        const nwRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nwRe;
      }
    }
  }
  if (inverse) {
    const s = 1 / n;
    for (let i = 0; i < n; i++) {
      re[i]! *= s;
      im[i]! *= s;
    }
  }
}

/** |RFFT(x)|^2 for k = 0..n/2. n=400 uses Bluestein. */
export function rfftPower(x: Float64Array): Float64Array {
  const n = x.length;
  if (n === 0) return new Float64Array(1);
  if ((n & (n - 1)) === 0) {
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    re.set(x);
    fftRadix2(re, im, false);
    const out = new Float64Array((n >> 1) + 1);
    for (let k = 0; k < out.length; k++) {
      out[k] = re[k]! * re[k]! + im[k]! * im[k]!;
    }
    return out;
  }
  return bluesteinRfftPower(x);
}

function bluesteinRfftPower(x: Float64Array): Float64Array {
  const n = x.length;
  let M = 1;
  while (M < 2 * n - 1) M <<= 1;
  const aRe = new Float64Array(M);
  const aIm = new Float64Array(M);
  const bRe = new Float64Array(M);
  const bIm = new Float64Array(M);
  for (let i = 0; i < n; i++) {
    const ang = Math.PI * i * i / n;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    aRe[i] = x[i]! * c;
    aIm[i] = x[i]! * -s;
    bRe[i] = c;
    bIm[i] = s;
  }
  for (let i = 1; i < n; i++) {
    bRe[M - i] = bRe[i]!;
    bIm[M - i] = bIm[i]!;
  }
  fftRadix2(aRe, aIm, false);
  fftRadix2(bRe, bIm, false);
  for (let i = 0; i < M; i++) {
    const r = aRe[i]! * bRe[i]! - aIm[i]! * bIm[i]!;
    const im = aRe[i]! * bIm[i]! + aIm[i]! * bRe[i]!;
    aRe[i] = r;
    aIm[i] = im;
  }
  fftRadix2(aRe, aIm, true);
  const out = new Float64Array((n >> 1) + 1);
  for (let k = 0; k < out.length; k++) {
    const ang = Math.PI * k * k / n;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const re = aRe[k]! * c + aIm[k]! * s;
    const im = -aRe[k]! * s + aIm[k]! * c;
    out[k] = re * re + im * im;
  }
  return out;
}

/** Slow reference RFFT power for tests. */
export function naiveRfftPower(x: Float64Array): Float64Array {
  const n = x.length;
  const out = new Float64Array((n >> 1) + 1);
  for (let k = 0; k < out.length; k++) {
    let re = 0;
    let im = 0;
    const ang = -2 * Math.PI * k / n;
    for (let t = 0; t < n; t++) {
      const a = ang * t;
      re += x[t]! * Math.cos(a);
      im += x[t]! * Math.sin(a);
    }
    out[k] = re * re + im * im;
  }
  return out;
}

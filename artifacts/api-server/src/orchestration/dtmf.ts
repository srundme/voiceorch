/**
 * DTMF (Dual-Tone Multi-Frequency) detection via the Goertzel algorithm.
 *
 * Works on 8 kHz LINEAR16 PCM (the same format the pipeline uses throughout).
 *
 * Usage:
 *   const detector = new DtmfDetector();
 *   // Feed 20 ms chunks as they arrive:
 *   const digit = detector.feed(pcm8kChunk); // returns "1"…"9","0","*","#" or null
 *
 * The detector requires a tone to be present for at least MIN_HIT_FRAMES
 * consecutive frames (each 20 ms) before reporting it, and enforces a minimum
 * inter-digit gap of GAP_FRAMES to avoid the same key being counted twice.
 */

// ── DTMF frequency grid ───────────────────────────────────────────────────────

const ROW_FREQS = [697, 770, 852, 941] as const;
const COL_FREQS = [1209, 1336, 1477, 1633] as const;

// prettier-ignore
const DTMF_GRID: string[][] = [
  ["1", "2", "3", "A"],
  ["4", "5", "6", "B"],
  ["7", "8", "9", "C"],
  ["*", "0", "#", "D"],
];

// ── Goertzel parameters ───────────────────────────────────────────────────────

const FS            = 8000;             // 8 kHz
const BLOCK_SAMPLES = 160;             // 20 ms block (one pipeline chunk)
const POWER_THRESH  = 6e6;             // minimum power to consider a tone present
const TWIST_LIMIT   = 8;               // max dB difference between row & col tone (ITU Q.24)
const MIN_HIT_FRAMES = 2;             // tone must persist for 2× 20 ms = 40 ms
const GAP_FRAMES    = 3;              // 60 ms silence before accepting the same digit again

interface GoertzelCoeff {
  coeff: number;
  cosine: number;
}

function makeCoeff(freq: number): GoertzelCoeff {
  const k      = Math.round((BLOCK_SAMPLES * freq) / FS);
  const omega  = (2 * Math.PI * k) / BLOCK_SAMPLES;
  const coeff  = 2 * Math.cos(omega);
  return { coeff, cosine: Math.cos(omega) };
}

function goertzelPower(samples: Int16Array, c: GoertzelCoeff): number {
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < samples.length; i++) {
    s0 = (samples[i]! / 32768) + c.coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s2 * s2 + s1 * s1 - c.coeff * s1 * s2;
}

// ── DtmfDetector ─────────────────────────────────────────────────────────────

export class DtmfDetector {
  private readonly rowCoeffs = ROW_FREQS.map(makeCoeff);
  private readonly colCoeffs = COL_FREQS.map(makeCoeff);

  private hitFrames  = 0;
  private lastDigit: string | null = null;
  private gapFrames  = 0;

  /**
   * Feed one 20 ms PCM16-LE chunk (160 samples × 2 bytes = 320 bytes).
   * Returns a detected digit string or null if no DTMF was found.
   */
  feed(pcm8k: Buffer): string | null {
    if (pcm8k.length < BLOCK_SAMPLES * 2) return null;

    const samples = new Int16Array(pcm8k.buffer, pcm8k.byteOffset, BLOCK_SAMPLES);

    const rowPowers = this.rowCoeffs.map(c => goertzelPower(samples, c));
    const colPowers = this.colCoeffs.map(c => goertzelPower(samples, c));

    const rowIdx = maxIndex(rowPowers);
    const colIdx = maxIndex(colPowers);

    const rowPow = rowPowers[rowIdx]!;
    const colPow = colPowers[colIdx]!;

    const digit = DTMF_GRID[rowIdx]?.[colIdx] ?? null;

    // Both tones must exceed threshold
    if (rowPow < POWER_THRESH || colPow < POWER_THRESH || digit === null) {
      this.hitFrames = 0;
      // Count inter-digit gap frames
      if (this.gapFrames < GAP_FRAMES) this.gapFrames++;
      return null;
    }

    // Check twist: neither tone should dominate the other by more than TWIST_LIMIT dB
    const twist = 10 * Math.log10(rowPow / colPow);
    if (Math.abs(twist) > TWIST_LIMIT) {
      this.hitFrames = 0;
      if (this.gapFrames < GAP_FRAMES) this.gapFrames++;
      return null;
    }

    this.hitFrames++;

    if (this.hitFrames >= MIN_HIT_FRAMES) {
      // Same digit still held — do not re-report until key released and gap elapsed
      if (digit === this.lastDigit && this.gapFrames < GAP_FRAMES) return null;

      this.lastDigit = digit;
      this.gapFrames = 0;
      return digit;
    }

    return null;
  }

  reset(): void {
    this.hitFrames = 0;
    this.lastDigit = null;
    this.gapFrames = GAP_FRAMES; // allow first detection immediately
  }
}

function maxIndex(arr: number[]): number {
  let best = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i]! > arr[best]!) best = i;
  }
  return best;
}

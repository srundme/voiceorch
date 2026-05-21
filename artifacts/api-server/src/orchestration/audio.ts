// μ-law (G.711 PCMU) codec — used by Twilio and Plivo
// 8-bit mulaw ↔ 16-bit linear PCM

const MULAW_BIAS = 33;
const MULAW_MAX = 0x1fff;

export function mulawToLinear(mulaw: number): number {
  mulaw = ~mulaw & 0xff;
  const sign = mulaw & 0x80 ? -1 : 1;
  const exponent = (mulaw >> 4) & 0x07;
  const mantissa = mulaw & 0x0f;
  const sample = ((mantissa << 1) + 33) << (exponent + 1);
  return sign * (sample - MULAW_BIAS);
}

export function linearToMulaw(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  sample = Math.min(sample, 32767);
  sample += MULAW_BIAS;
  if (sample > MULAW_MAX) sample = MULAW_MAX;

  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}

  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export function decodeMulaw(mulawBytes: Buffer): Buffer {
  const pcm = Buffer.allocUnsafe(mulawBytes.length * 2);
  for (let i = 0; i < mulawBytes.length; i++) {
    const sample = mulawToLinear(mulawBytes[i]!);
    pcm.writeInt16LE(sample, i * 2);
  }
  return pcm;
}

export function encodeMulaw(pcmBuffer: Buffer): Buffer {
  const mulaw = Buffer.allocUnsafe(pcmBuffer.length / 2);
  for (let i = 0; i < mulaw.length; i++) {
    const sample = pcmBuffer.readInt16LE(i * 2);
    mulaw[i] = linearToMulaw(sample);
  }
  return mulaw;
}

// Upsample from 8kHz to 16kHz (linear interpolation) for STT APIs
export function upsample8to16(buf8k: Buffer): Buffer {
  const samples = buf8k.length / 2;
  const out = Buffer.allocUnsafe(samples * 2 * 2); // 2x more samples, 2 bytes each
  for (let i = 0; i < samples; i++) {
    const s = buf8k.readInt16LE(i * 2);
    const next = i + 1 < samples ? buf8k.readInt16LE((i + 1) * 2) : s;
    out.writeInt16LE(s, i * 4);
    out.writeInt16LE(Math.round((s + next) / 2), i * 4 + 2);
  }
  return out;
}

/**
 * Downsample from 16 kHz to 8 kHz with a simple 2-tap FIR anti-alias filter.
 *
 * Naive decimation (taking every other sample) folds frequencies above 4 kHz
 * back into the 0–4 kHz band (Nyquist of 8 kHz output).  For pitch detection
 * this creates aliasing artefacts that can shift the apparent fundamental.
 * A basic average of adjacent pairs halves the aliasing amplitude while
 * keeping the code dependency-free.
 */
export function downsample16to8(buf16k: Buffer): Buffer {
  const samples    = Math.floor(buf16k.length / 4) * 2; // must be even
  const outSamples = samples / 2;
  const out        = Buffer.allocUnsafe(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const a = buf16k.readInt16LE(i * 4);
    const b = buf16k.readInt16LE(i * 4 + 2);
    out.writeInt16LE(Math.round((a + b) / 2), i * 2);
  }
  return out;
}

// ── Noise Cancellation ───────────────────────────────────────────────────────
//
// Two-stage pipeline applied to 8 kHz LINEAR16 PCM before it reaches any STT:
//
//   1. 4th-order Butterworth bandpass filter (300–3400 Hz)
//      Removes sub-300 Hz mains hum / HVAC rumble and >3400 Hz hiss.
//      Coefficients computed for fs=8000 Hz via bilinear transform.
//
//   2. Adaptive noise gate
//      Maintains a rolling estimate of the background noise floor (RMS of
//      low-energy frames) and suppresses frames whose energy is below
//      GATE_RATIO × noiseFloor.  Speech frames are passed unmodified.

// --- Butterworth 300–3400 Hz bandpass @ 8000 Hz (biquad cascade, 2 sections) ---
// Each section: [b0, b1, b2, a1, a2]  (a0 = 1, direct form II)
const BP_SECTIONS: [number, number, number, number, number][] = [
  // Section 1
  [ 0.13072,  0.0,      -0.13072, -1.38122,  0.73856 ],
  // Section 2
  [ 1.0,     -2.0,       1.0,     -1.64996,  0.84016 ],
];

interface BiquadState { x1: number; x2: number; y1: number; y2: number }

function makeBiquadStates(): BiquadState[] {
  return BP_SECTIONS.map(() => ({ x1: 0, x2: 0, y1: 0, y2: 0 }));
}

function applyBiquadSection(
  sample: number,
  coeff: [number, number, number, number, number],
  s: BiquadState
): number {
  const [b0, b1, b2, a1, a2] = coeff;
  const y = b0 * sample + b1 * s.x1 + b2 * s.x2 - a1 * s.y1 - a2 * s.y2;
  s.x2 = s.x1; s.x1 = sample;
  s.y2 = s.y1; s.y1 = y;
  return y;
}

function bandpassFilter(samples: Int16Array, states: BiquadState[]): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    let v = samples[i]! / 32768;
    for (let s = 0; s < BP_SECTIONS.length; s++) {
      v = applyBiquadSection(v, BP_SECTIONS[s]!, states[s]!);
    }
    out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32768)));
  }
  return out;
}

// --- Adaptive noise gate ---
const GATE_RATIO        = 3.0;   // suppress frames below 3× estimated noise floor
const NOISE_ALPHA       = 0.98;  // slow-tracking IIR for noise floor estimate
const NOISE_FRAME_BYTES = 320;   // 20 ms @ 8 kHz → 160 samples → 320 bytes

function rms(samples: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += (samples[i]! / 32768) ** 2;
  return Math.sqrt(sum / samples.length);
}

/**
 * NoiseCanceller is stateful — create one instance per call session.
 * Call process(pcm8k) on every incoming 8 kHz LINEAR16 PCM chunk.
 */
export class NoiseCanceller {
  private readonly bqStates: BiquadState[] = makeBiquadStates();
  private noiseFloor = 0.02;   // initial estimate (~-34 dBFS)

  process(pcm8k: Buffer): Buffer {
    const samples = new Int16Array(pcm8k.buffer, pcm8k.byteOffset, pcm8k.length / 2);

    // Stage 1 — bandpass
    const filtered = bandpassFilter(samples, this.bqStates);

    // Stage 2 — adaptive noise gate (process in 20 ms frames)
    const frameSize = NOISE_FRAME_BYTES / 2;   // 160 samples
    const out = new Int16Array(filtered.length);

    for (let offset = 0; offset < filtered.length; offset += frameSize) {
      const end   = Math.min(offset + frameSize, filtered.length);
      const frame = filtered.subarray(offset, end);
      const energy = rms(frame);

      if (energy < this.noiseFloor * GATE_RATIO) {
        // Low-energy frame: update noise estimate and zero-out
        this.noiseFloor = NOISE_ALPHA * this.noiseFloor + (1 - NOISE_ALPHA) * energy;
        out.fill(0, offset, end);
      } else {
        // Speech frame: pass through, update noise estimate slowly
        this.noiseFloor = NOISE_ALPHA * this.noiseFloor + (1 - NOISE_ALPHA) * energy * 0.05;
        out.set(frame, offset);
      }
    }

    return Buffer.from(out.buffer);
  }
}

// ── Pitch estimation (autocorrelation) ───────────────────────────────────────
//
// Estimates the fundamental frequency (F0) of 8 kHz LINEAR16 PCM audio.
// Searches the human voiced-speech range 60–400 Hz (lags 20–133 @ 8 kHz).
// Returns frequency in Hz, or 0 when no clear pitch is detected.

function autocorrSum(x: Float32Array, analysisLen: number, lag: number): number {
  let sum = 0;
  const n = Math.min(analysisLen - lag, analysisLen);
  for (let i = 0; i < n; i++) sum += x[i]! * x[i + lag]!;
  return sum;
}

export function estimatePitch(pcm8k: Buffer): number {
  const samples = pcm8k.length / 2;
  if (samples < 800) return 0;   // need at least 100 ms @ 8 kHz

  const x = new Float32Array(samples);
  for (let i = 0; i < samples; i++) x[i] = pcm8k.readInt16LE(i * 2) / 32768;

  const analysisLen = Math.min(samples, 2048);
  const FS = 8000;
  const minLag = Math.floor(FS / 400);   // 20  — 400 Hz ceiling
  const maxLag = Math.min(Math.floor(FS / 60), analysisLen - 1);  // 133 — 60 Hz floor

  const r0 = autocorrSum(x, analysisLen, 0);
  if (r0 === 0) return 0;

  let bestLag = 0;
  let bestNorm = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    const norm = autocorrSum(x, analysisLen, lag) / r0;
    if (norm > bestNorm) { bestNorm = norm; bestLag = lag; }
  }

  if (bestNorm < 0.35) return 0;   // insufficient periodicity — unvoiced frame

  // ── Octave-error correction ────────────────────────────────────────────────
  // Autocorrelation has a known failure mode: when the signal has a strong
  // 2nd harmonic, the normalised correlation at lag T/2 (i.e. 2×F0) can
  // exceed the correlation at lag T (F0 itself).  This makes a 130 Hz male
  // voice appear as 260 Hz (female range).  Fix: if double the bestLag has
  // correlation ≥ 75 % of bestNorm, the true fundamental is at that lower
  // frequency.  Repeat until no further sub-harmonic is found.
  let corrected = bestLag;
  for (let candidate = corrected * 2; candidate <= maxLag; candidate = corrected * 2) {
    const r = autocorrSum(x, analysisLen, candidate) / r0;
    if (r >= 0.75 * bestNorm) { corrected = candidate; }
    else break;
  }

  return FS / corrected;
}

// ── Gender classification from pitch ─────────────────────────────────────────
//
// Vocal F0 ranges (typical):
//   Male:   85 – 180 Hz   (median ~120 Hz)
//   Female: 165 – 255 Hz  (median ~210 Hz)
//   Overlap 165–180 Hz → classified by midpoint 172.5 Hz

export type VoiceGender = "male" | "female" | "unknown";

/**
 * Classify the speaker's gender from raw 8 kHz LINEAR16 PCM.
 *
 * Uses multi-frame median pitch estimation instead of a single-frame estimate.
 * The buffer is split into non-overlapping 256 ms windows (2048 samples each —
 * the same size estimatePitch analyses internally).  The median F0 across all
 * voiced frames is used for classification, which is robust against:
 *   - Short utterances starting with unvoiced consonants ("h" in "hello")
 *   - Glottal stops, fricatives, and other transient artefacts
 *   - Outlier frames caused by background noise
 *
 * At least 2 voiced frames must be found; otherwise "unknown" is returned so
 * the system falls back to the neutral salutation rather than guessing wrong.
 */
export function detectGenderFromPcm(pcm8k: Buffer): VoiceGender {
  const FRAME_SAMPLES = 2048;          // 256 ms @ 8 kHz
  const FRAME_BYTES   = FRAME_SAMPLES * 2;
  const pitches: number[] = [];

  for (let offset = 0; offset + FRAME_BYTES <= pcm8k.length; offset += FRAME_BYTES) {
    const f0 = estimatePitch(pcm8k.subarray(offset, offset + FRAME_BYTES));
    if (f0 > 0) pitches.push(f0);
  }

  // Require at least 2 voiced frames — single-frame estimates are unreliable
  if (pitches.length < 2) {
    process.stderr.write(`[gender-dbg] frames=${pitches.length} (insufficient) → unknown\n`);
    return "unknown";
  }

  // Median is robust against outlier frames
  pitches.sort((a, b) => a - b);
  const mid = Math.floor(pitches.length / 2);
  const medianF0 = pitches.length % 2 === 1
    ? pitches[mid]!
    : (pitches[mid - 1]! + pitches[mid]!) / 2;

  const rounded = pitches.map(f => Math.round(f));
  process.stderr.write(
    `[gender-dbg] frames=[${rounded.join(",")}] median=${Math.round(medianF0)} Hz bufBytes=${pcm8k.length}\n`
  );

  if (medianF0 < 165) return "male";
  if (medianF0 > 180) return "female";
  return medianF0 < 172.5 ? "male" : "female";
}

// ── Energy-based voice activity detection: returns true if audio contains speech
export function hasSpeechEnergy(pcmBuffer: Buffer, threshold = 300): boolean {
  if (pcmBuffer.length < 2) return false;
  let sumSq = 0;
  const samples = pcmBuffer.length / 2;
  for (let i = 0; i < samples; i++) {
    const s = pcmBuffer.readInt16LE(i * 2);
    sumSq += s * s;
  }
  const rms = Math.sqrt(sumSq / samples);
  return rms > threshold;
}

// Build a minimal WAV header for PCM data (for REST-based STT APIs)
export function pcmToWav(pcm: Buffer, sampleRate = 16000, channels = 1, bitsPerSample = 16): Buffer {
  const dataSize = pcm.length;
  const header = Buffer.allocUnsafe(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);          // PCM chunk size
  header.writeUInt16LE(1, 20);           // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
  header.writeUInt16LE(channels * bitsPerSample / 8, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

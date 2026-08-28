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

// ── Windowed-sinc anti-alias decimation ─────────────────────────────────────
//
// The previous 2-tap (16→8) and 3-tap box (24→8) filters only attenuated the
// aliasing band by ~3–8 dB, so TTS energy above the output Nyquist folded back
// into the voice band as metallic harshness — and once baked into the 8 kHz
// wire signal the carrier cannot remove it.  These Hamming-windowed sinc
// kernels give ~45 dB rejection while staying dependency-free and stateless
// (same signatures / output lengths as before).  Block-edge samples renormalize
// the kernel over the available window so chunked calls don't click or droop.
//
// IMPORTANT: renormalizing is only correct for a ONE-SHOT call over a whole
// buffer.  On a chunked stream (the TTS drain sends 20 ms blocks) the taps that
// fall outside the block are missing real audio, and renormalizing swaps the
// filter's response for a wider, barely-anti-aliased one on those samples.  At
// 20 ms blocks that is 10 of every 160 output samples, so the defect repeats at
// exactly 50 Hz — an audible buzz/grit riding on the voice (~33 dB SNR vs a
// continuous filter).  Streaming callers must use the stateful decimators below,
// which carry the previous block's tail and therefore always see a full kernel.

/** Hamming-windowed sinc low-pass kernel, unity DC gain. `cutoffNorm` = fc/fsIn. */
function buildSincKernel(taps: number, cutoffNorm: number, fracOffset = 0): Float64Array {
  const h = new Float64Array(taps);
  const mid = (taps - 1) / 2 + fracOffset;
  let sum = 0;
  for (let k = 0; k < taps; k++) {
    const x = k - mid;
    const sinc = x === 0 ? 1 : Math.sin(2 * Math.PI * cutoffNorm * x) / (2 * Math.PI * cutoffNorm * x);
    const win = 0.54 - 0.46 * Math.cos((2 * Math.PI * k) / (taps - 1));
    h[k] = 2 * cutoffNorm * sinc * win;
    sum += h[k];
  }
  for (let k = 0; k < taps; k++) h[k] /= sum; // unity gain at DC
  return h;
}

/** Apply `kernel` centred at input sample `center`, renormalizing at block edges. */
function firAt(buf: Buffer, inSamples: number, center: number, kernel: Float64Array): number {
  const half = (kernel.length - 1) >> 1;
  let acc = 0;
  let wsum = 0;
  for (let k = 0; k < kernel.length; k++) {
    const idx = center - half + k;
    if (idx < 0 || idx >= inSamples) continue;
    acc += buf.readInt16LE(idx * 2) * kernel[k]!;
    wsum += kernel[k]!;
  }
  if (wsum === 0) return 0;
  const s = Math.round(acc / wsum);
  return s > 32767 ? 32767 : s < -32768 ? -32768 : s;
}

// 16→8: cutoff 3.4 kHz (voice band top), 63 taps (~45 dB stopband; 15 taps
// still leaked grit on Cartesia sibilants after a second downsample).
const K16TO8 = buildSincKernel(63, 3400 / 16000);
// 24→8: steeper ratio needs a longer kernel; cutoff 3.4 kHz, 21 taps.
const K24TO8 = buildSincKernel(21, 3400 / 24000);
// 24→16: output Nyquist 8 kHz, cutoff 7.2 kHz for margin; alternate phases 0 / 0.5.
const K24TO16_P0 = buildSincKernel(15, 7200 / 24000, 0);
const K24TO16_P5 = buildSincKernel(15, 7200 / 24000, 0.5);

/**
 * Downsample 16 kHz PCM16 LE → 8 kHz with a 15-tap windowed-sinc anti-alias
 * filter (~45 dB rejection above 4 kHz vs ~3 dB for the old 2-tap average).
 * Stateless and length-preserving: output is exactly floor(in/4)*2 samples,
 * matching the previous contract (callers rely on no trailing-sample drops).
 */
export function downsample16to8(buf16k: Buffer): Buffer {
  const samples    = Math.floor(buf16k.length / 4) * 2; // must be even
  const outSamples = samples / 2;
  const out        = Buffer.allocUnsafe(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    out.writeInt16LE(firAt(buf16k, samples, i * 2, K16TO8), i * 2);
  }
  return out;
}

/**
 * Downsample 24 kHz PCM16 LE → 8 kHz with a 21-tap windowed-sinc filter.
 * Gemini Live outputs 24 kHz; telephony + webcall wire formats use 8 kHz.
 */
export function downsample24to8(buf24k: Buffer): Buffer {
  const inSamples = Math.floor(buf24k.length / 2);
  const groups = Math.floor(inSamples / 3);
  const out = Buffer.allocUnsafe(groups * 2);
  for (let i = 0; i < groups; i++) {
    out.writeInt16LE(firAt(buf24k, inSamples, i * 3 + 1, K24TO8), i * 2);
  }
  return out;
}

/**
 * Block-continuous decimator: same kernels as the one-shot helpers above, but
 * it retains the previous chunk's tail so every output sample is computed from
 * a full kernel instead of a renormalized partial one.
 *
 * Output length per call matches the stateless helper exactly (`floor(n/factor)`
 * samples), so wire framing and byte accounting are unchanged.  The cost is a
 * fixed `half`-input-sample delay (0.44 ms at 16 kHz, 0.42 ms at 24 kHz), which
 * is well inside a single 20 ms frame.
 */
export class StreamingDecimator {
  private readonly half: number;
  /** Input samples of lookahead, rounded up to a whole number of output samples so the decimation phase is unchanged. */
  private readonly delay: number;
  private readonly histSamples: number;
  /** [ histSamples of context | <factor unconsumed remainder samples ]. */
  private carry: Buffer;

  constructor(
    private readonly kernel: Float64Array,
    private readonly factor: number,
    private readonly offset = 0,
  ) {
    this.half = (kernel.length - 1) >> 1;
    this.delay = Math.ceil(this.half / factor) * factor;
    this.histSamples = this.delay + this.half;
    this.carry = Buffer.alloc(this.histSamples * 2); // silence pre-roll
  }

  /** Output lag in whole output samples, relative to the one-shot helper. */
  get delaySamples(): number {
    return this.delay / this.factor;
  }

  /** Reset to a silent pre-roll — call between utterances so one sentence's tail cannot bleed into the next. */
  reset(): void {
    this.carry = Buffer.alloc(this.histSamples * 2);
  }

  process(input: Buffer): Buffer {
    const combined = this.carry.length ? Buffer.concat([this.carry, input]) : input;
    const available = combined.length / 2 - this.histSamples;
    const outSamples = Math.max(0, Math.floor(available / this.factor));
    const out = Buffer.allocUnsafe(outSamples * 2);
    for (let i = 0; i < outSamples; i++) {
      // Lag the newest input by `half` so the kernel's right-hand taps are
      // always backed by real samples rather than zero-padding.
      const center = this.half + i * this.factor + this.offset;
      let acc = 0;
      for (let k = 0; k < this.kernel.length; k++) {
        acc += combined.readInt16LE((center - this.half + k) * 2) * this.kernel[k]!;
      }
      const s = Math.round(acc);
      out.writeInt16LE(s > 32767 ? 32767 : s < -32768 ? -32768 : s, i * 2);
    }
    // Drop the samples now fully consumed; what remains is exactly the history
    // window plus any sub-factor remainder to prepend to the next chunk.
    this.carry = combined.subarray(outSamples * this.factor * 2);
    return out;
  }
}

/** Streaming 16 kHz → 8 kHz decimator (TTS wire output, webcall mic). */
export function createDownsampler16to8(): StreamingDecimator {
  return new StreamingDecimator(K16TO8, 2, 0);
}

/** Streaming 24 kHz → 8 kHz decimator (Gemini Live wire output). */
export function createDownsampler24to8(): StreamingDecimator {
  return new StreamingDecimator(K24TO8, 3, 1);
}

/**
 * Downsample 24 kHz PCM16 LE → 16 kHz (2:3 ratio) via polyphase windowed-sinc
 * (source positions alternate between integer and half-sample offsets, so two
 * precomputed kernel phases cover every output sample exactly).
 */
export function downsample24to16(buf24k: Buffer): Buffer {
  const inSamples = Math.floor(buf24k.length / 2);
  const outSamples = Math.floor((inSamples * 2) / 3);
  const out = Buffer.allocUnsafe(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const srcPos = (i * 3) / 2;
    const idx = Math.floor(srcPos);
    const kernel = srcPos === idx ? K24TO16_P0 : K24TO16_P5;
    out.writeInt16LE(firAt(buf24k, inSamples, idx, kernel), i * 2);
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

/**
 * Filter an 8 kHz LINEAR16 loop through the telephony passband (300–3400 Hz)
 * with fresh filter state. Used to measure the in-band energy that actually
 * survives a phone carrier, so ambient levels can be normalised against what
 * the caller really hears rather than the broadband signal.
 */
export function telephonyBandpass(samples: Int16Array): Int16Array {
  return bandpassFilter(samples, makeBiquadStates());
}

// --- Adaptive noise gate ---
const GATE_RATIO          = 4.0;   // suppress frames below 4× estimated noise floor
const NOISE_ALPHA         = 0.98;  // slow-tracking IIR for noise-frame noise floor updates
const CALIB_ALPHA         = 0.7;   // fast-tracking IIR used during calibration phase
const CALIB_FRAMES        = 25;    // ~500 ms @ 20 ms/frame before gating begins
const NOISE_FRAME_BYTES   = 320;   // 20 ms @ 8 kHz → 160 samples → 320 bytes
// Below-threshold frames are ATTENUATED, not replaced with pure digital silence.
// Hard-zeroing erased short/soft utterances ("yes", "okay") entirely before they
// reached any STT provider — the provider-independent one-word-reply loss (call
// 2039). Attenuated frames keep enough residual signal for STT VADs to latch
// onto quiet speech onsets while still suppressing background noise.
const GATE_ATTENUATION    = 0.15;  // scale gated frames to 15% instead of zeroing
// After a speech frame, keep the gate open for this many subsequent frames
// (hangover) so brief pauses inside/around short utterances aren't clipped.
const GATE_HANGOVER_FRAMES = 5;    // 5 × 20 ms = 100 ms hangover

function rms(samples: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += (samples[i]! / 32768) ** 2;
  return Math.sqrt(sum / samples.length);
}

/**
 * NoiseCanceller is stateful — create one instance per call session.
 * Call process(pcm8k) on every incoming 8 kHz LINEAR16 PCM chunk.
 *
 * Calibration phase (first CALIB_FRAMES frames ≈ 500 ms):
 *   Audio passes through unmodified while a fast IIR (CALIB_ALPHA) builds an
 *   initial noise floor estimate from the ambient environment.  Gating only
 *   begins after calibration completes.
 *
 * Active phase:
 *   - Noise frames (energy < noiseFloor × GATE_RATIO): attenuated to
 *     GATE_ATTENUATION (NOT zeroed — hard-zeroing erased short/soft caller
 *     utterances before STT); noise floor updated with slow IIR (NOISE_ALPHA).
 *   - Speech frames (energy ≥ noiseFloor × GATE_RATIO): passed through and the
 *     gate is held open for GATE_HANGOVER_FRAMES so speech onsets/tails are not
 *     clipped; noise floor is NOT updated downward so the calibrated background
 *     estimate is preserved across speech bursts.
 */
export class NoiseCanceller {
  private readonly bqStates: BiquadState[] = makeBiquadStates();
  private noiseFloor      = 0.0;
  private calibFrameCount = 0;
  private hangoverFrames  = 0;
  /** Per-agent "Mic Sensitivity" lever (see mic-sensitivity.ts). Defaults to the
   *  original hardcoded ratio so agents without the setting are unaffected. */
  private readonly gateRatio: number;

  constructor(gateRatio: number = GATE_RATIO) {
    this.gateRatio = gateRatio;
  }

  process(pcm8k: Buffer): Buffer {
    const samples = new Int16Array(pcm8k.buffer, pcm8k.byteOffset, pcm8k.length / 2);

    // Stage 1 — bandpass
    const filtered = bandpassFilter(samples, this.bqStates);

    // Stage 2 — adaptive noise gate (process in 20 ms frames)
    const frameSize = NOISE_FRAME_BYTES / 2;   // 160 samples
    const out = new Int16Array(filtered.length);

    for (let offset = 0; offset < filtered.length; offset += frameSize) {
      const end    = Math.min(offset + frameSize, filtered.length);
      const frame  = filtered.subarray(offset, end);
      const energy = rms(frame);

      if (this.calibFrameCount < CALIB_FRAMES) {
        // Calibration phase: build ambient noise estimate, pass audio through.
        this.noiseFloor = this.calibFrameCount === 0
          ? energy
          : CALIB_ALPHA * this.noiseFloor + (1 - CALIB_ALPHA) * energy;
        this.calibFrameCount++;
        out.set(frame, offset);
        continue;
      }

      if (energy < this.noiseFloor * this.gateRatio) {
        if (this.hangoverFrames > 0) {
          // Hangover: a speech frame occurred recently — keep the gate open so
          // brief dips inside/around a short utterance aren't clipped. The
          // noise floor is NOT updated here (the frame may carry a speech tail).
          this.hangoverFrames--;
          out.set(frame, offset);
        } else {
          // Noise frame: update noise floor estimate and attenuate. Never
          // hard-zero — pure digital silence erased short/soft utterances
          // entirely before they reached any STT provider (call 2039).
          this.noiseFloor = NOISE_ALPHA * this.noiseFloor + (1 - NOISE_ALPHA) * energy;
          for (let i = offset; i < end; i++) {
            out[i] = Math.round(filtered[i]! * GATE_ATTENUATION);
          }
        }
      } else {
        // Speech frame: pass through and hold the gate open; do NOT pull the
        // noise floor down — preserve the calibrated background estimate
        // across speech bursts.
        this.hangoverFrames = GATE_HANGOVER_FRAMES;
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

// ── Energy-based voice activity detection: returns true if audio contains speech
export function frameRms(pcmBuffer: Buffer): number {
  if (pcmBuffer.length < 2) return 0;
  let sumSq = 0;
  const samples = pcmBuffer.length / 2;
  for (let i = 0; i < samples; i++) {
    const s = pcmBuffer.readInt16LE(i * 2);
    sumSq += s * s;
  }
  return Math.sqrt(sumSq / samples);
}

export function hasSpeechEnergy(pcmBuffer: Buffer, threshold = 300): boolean {
  return frameRms(pcmBuffer) > threshold;
}

/** Pad a short telephony frame to exact 20 ms so VoBiz never sees a runt playAudio payload. */
export function padWireFrame(chunk: Buffer, frameBytes: number): Buffer {
  if (chunk.length === frameBytes) return chunk;
  const padded = Buffer.alloc(frameBytes);
  chunk.copy(padded);
  return padded;
}

/** Split PCM into exact 20 ms frames, carrying a remainder across blocks. */
export function enqueueExactFrames(
  pcm: Buffer,
  frameBytes: number,
  queue: Buffer[],
  rem: { buf: Buffer },
): void {
  const combined = rem.buf.length > 0 ? Buffer.concat([rem.buf, pcm]) : pcm;
  let offset = 0;
  while (offset + frameBytes <= combined.length) {
    queue.push(combined.subarray(offset, offset + frameBytes));
    offset += frameBytes;
  }
  rem.buf = offset < combined.length ? combined.subarray(offset) : Buffer.alloc(0);
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

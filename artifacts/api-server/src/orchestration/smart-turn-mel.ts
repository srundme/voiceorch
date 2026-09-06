/**
 * Whisper Tiny log-mel features for Pipecat Smart Turn v3.
 * Mirrors pipecat.audio.turn.smart_turn._whisper_features (BSD-2 / HF Apache-2.0).
 */

import { rfftPower } from "./smart-turn-fft.js";

const N_FFT = 400;
const HOP_LENGTH = 160;
const N_MELS = 80;
const SAMPLING_RATE = 16000;
const MEL_FLOOR = 1e-10;
const NORM_VARIANCE_EPS = 1e-7;
const N_SAMPLES = SAMPLING_RATE * 8; // 128000
const N_FREQ = N_FFT / 2 + 1; // 201

function hertzToMelSlaney(freq: number): number {
  const minLogHertz = 1000;
  const minLogMel = 15;
  const logstep = 27 / Math.log(6.4);
  if (freq >= minLogHertz) return minLogMel + Math.log(freq / minLogHertz) * logstep;
  return 3 * freq / 200;
}

function melToHertzSlaney(mel: number): number {
  const minLogHertz = 1000;
  const minLogMel = 15;
  const logstep = Math.log(6.4) / 27;
  if (mel >= minLogMel) return minLogHertz * Math.exp(logstep * (mel - minLogMel));
  return 200 * mel / 3;
}

function buildMelFilterbank(): Float64Array {
  const melMin = hertzToMelSlaney(0);
  const melMax = hertzToMelSlaney(SAMPLING_RATE / 2);
  const melFreqs = new Float64Array(N_MELS + 2);
  for (let i = 0; i < melFreqs.length; i++) {
    melFreqs[i] = melMin + (melMax - melMin) * i / (N_MELS + 1);
  }
  const filterFreqs = new Float64Array(melFreqs.length);
  for (let i = 0; i < melFreqs.length; i++) filterFreqs[i] = melToHertzSlaney(melFreqs[i]!);
  const fftFreqs = new Float64Array(N_FREQ);
  for (let i = 0; i < N_FREQ; i++) fftFreqs[i] = (SAMPLING_RATE / 2) * i / (N_FREQ - 1);

  const filters = new Float64Array(N_FREQ * N_MELS);
  for (let m = 0; m < N_MELS; m++) {
    const f0 = filterFreqs[m]!;
    const f1 = filterFreqs[m + 1]!;
    const f2 = filterFreqs[m + 2]!;
    const down = f1 - f0;
    const up = f2 - f1;
    for (let k = 0; k < N_FREQ; k++) {
      const hz = fftFreqs[k]!;
      const lower = down > 0 ? (hz - f0) / down : 0;
      const upper = up > 0 ? (f2 - hz) / up : 0;
      const w = Math.max(0, Math.min(lower, upper));
      filters[k * N_MELS + m] = w;
    }
  }
  for (let m = 0; m < N_MELS; m++) {
    const enorm = 2 / (filterFreqs[m + 2]! - filterFreqs[m]!);
    for (let k = 0; k < N_FREQ; k++) {
      filters[k * N_MELS + m]! *= enorm;
    }
  }
  return filters;
}

function periodicHann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

const HANN_WINDOW = periodicHann(N_FFT);
const MEL_FILTERS = buildMelFilterbank();

function reflectPad(x: Float32Array, pad: number): Float64Array {
  const n = x.length;
  const out = new Float64Array(n + 2 * pad);
  for (let i = 0; i < n; i++) out[pad + i] = x[i]!;
  for (let i = 0; i < pad; i++) {
    const srcL = Math.min(n - 1, i + 1);
    const srcR = Math.max(0, n - 2 - i);
    out[pad - 1 - i] = x[srcL]!;
    out[pad + n + i] = x[srcR]!;
  }
  return out;
}

/**
 * Float32 log-mel of shape (80, 800). Caller should pass 16 kHz mono audio;
 * we pad/truncate to 8 seconds at the end, matching the Python extractor.
 */
export function computeWhisperLogMelFeatures(audio: Float32Array, doNormalize = true): Float32Array {
  let x = audio;
  if (x.length < N_SAMPLES) {
    const padded = new Float32Array(N_SAMPLES);
    padded.set(x);
    x = padded;
  } else if (x.length > N_SAMPLES) {
    x = x.subarray(0, N_SAMPLES);
  }
  if (doNormalize) {
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += x[i]!;
    const mean = sum / x.length;
    let varSum = 0;
    for (let i = 0; i < x.length; i++) {
      const d = x[i]! - mean;
      varSum += d * d;
    }
    const inv = 1 / Math.sqrt(varSum / x.length + NORM_VARIANCE_EPS);
    const normed = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) normed[i] = (x[i]! - mean) * inv;
    x = normed;
  }

  const pad = N_FFT >> 1;
  const padded = reflectPad(x, pad);
  const nFramesFull = Math.floor((padded.length - N_FFT) / HOP_LENGTH) + 1;
  const nFrames = nFramesFull - 1; // drop trailing frame, matching transformers
  const logMel = new Float32Array(N_MELS * nFrames);
  const frame = new Float64Array(N_FFT);

  for (let t = 0; t < nFrames; t++) {
    const off = t * HOP_LENGTH;
    for (let i = 0; i < N_FFT; i++) {
      frame[i] = padded[off + i]! * HANN_WINDOW[i]!;
    }
    const power = rfftPower(frame);
    let maxLog = -Infinity;
    const mel = new Float64Array(N_MELS);
    for (let m = 0; m < N_MELS; m++) {
      let acc = 0;
      for (let k = 0; k < N_FREQ; k++) {
        acc += MEL_FILTERS[k * N_MELS + m]! * power[k]!;
      }
      const v = Math.log10(Math.max(MEL_FLOOR, acc));
      mel[m] = v;
      if (v > maxLog) maxLog = v;
    }
    const floor = maxLog - 8;
    for (let m = 0; m < N_MELS; m++) {
      const v = Math.max(mel[m]!, floor);
      logMel[m * nFrames + t] = (v + 4) / 4;
    }
  }
  return logMel;
}

export const SMART_TURN_N_MELS = N_MELS;
export const SMART_TURN_N_FRAMES = 800;
export const SMART_TURN_SAMPLE_RATE = SAMPLING_RATE;
export const SMART_TURN_MAX_SAMPLES = N_SAMPLES;

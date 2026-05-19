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

// Downsample from 16kHz to 8kHz (drop every other sample)
export function downsample16to8(buf16k: Buffer): Buffer {
  const samples = buf16k.length / 2;
  const out = Buffer.allocUnsafe((samples / 2) * 2);
  for (let i = 0; i < samples / 2; i++) {
    const s = buf16k.readInt16LE(i * 4);
    out.writeInt16LE(s, i * 2);
  }
  return out;
}

// Energy-based voice activity detection: returns true if audio contains speech
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

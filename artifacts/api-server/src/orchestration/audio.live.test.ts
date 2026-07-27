import { describe, expect, it } from "vitest";
import { downsample16to8, downsample24to8, downsample24to16, upsample8to16 } from "./audio.js";

describe("audio resampling for Gemini Live", () => {
  it("downsample24to8 produces 8k output with expected byte ratio", () => {
    // 30 samples @ 24kHz = 60 bytes in, 10 samples @ 8kHz = 20 bytes out
    const pcm24k = Buffer.alloc(60);
    for (let i = 0; i < 30; i++) {
      pcm24k.writeInt16LE(1000 + i, i * 2);
    }
    const pcm8k = downsample24to8(pcm24k);
    expect(pcm8k.length).toBe(20);
  });

  it("round-trips 8k→16k without crashing", () => {
    const pcm8k = Buffer.alloc(320);
    for (let i = 0; i < 160; i++) {
      pcm8k.writeInt16LE(Math.sin(i / 10) * 10000, i * 2);
    }
    const pcm16k = upsample8to16(pcm8k);
    expect(pcm16k.length).toBe(640);
  });
});

// ── Anti-alias quality guards ────────────────────────────────────────────────
// The downsamplers use windowed-sinc kernels; these tests pin the two
// properties that matter audibly: voice-band tones pass at ~unity gain, and
// tones above the output Nyquist are strongly rejected instead of folding
// back into the voice band as metallic harshness.

function sine(freq: number, sampleRate: number, samples: number, amp = 12000): Buffer {
  const buf = Buffer.allocUnsafe(samples * 2);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(amp * Math.sin((2 * Math.PI * freq * i) / sampleRate)), i * 2);
  }
  return buf;
}

/** RMS over the central 50% of a PCM16 buffer (skips filter edge regions). */
function centralRms(buf: Buffer): number {
  const samples = buf.length >> 1;
  const start = samples >> 2;
  const end = samples - start;
  let acc = 0;
  for (let i = start; i < end; i++) {
    const s = buf.readInt16LE(i * 2);
    acc += s * s;
  }
  return Math.sqrt(acc / (end - start));
}

describe("downsample anti-alias behaviour", () => {
  it("16→8 preserves output length contract", () => {
    const out = downsample16to8(sine(1000, 16000, 1600));
    expect(out.length).toBe(1600); // 1600 samples in → 800 samples (1600 bytes) out
  });

  it("16→8 passes a 1 kHz voice-band tone at ~unity gain", () => {
    const inBuf = sine(1000, 16000, 3200);
    const ratio = centralRms(downsample16to8(inBuf)) / centralRms(inBuf);
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.15);
  });

  it("16→8 strongly rejects a 6 kHz tone (would alias to 2 kHz)", () => {
    const inBuf = sine(6000, 16000, 3200);
    const ratio = centralRms(downsample16to8(inBuf)) / centralRms(inBuf);
    expect(ratio).toBeLessThan(0.1); // old 2-tap average leaked ~0.38 through
  });

  it("24→8 strongly rejects a 6 kHz tone", () => {
    const inBuf = sine(6000, 24000, 4800);
    const ratio = centralRms(downsample24to8(inBuf)) / centralRms(inBuf);
    expect(ratio).toBeLessThan(0.1);
  });

  it("24→16 passes 1 kHz at ~unity and keeps the 2:3 length contract", () => {
    const inBuf = sine(1000, 24000, 4800);
    const out = downsample24to16(inBuf);
    expect(out.length).toBe(Math.floor((4800 * 2) / 3) * 2);
    const ratio = centralRms(out) / centralRms(inBuf);
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.15);
  });

  it("24→16 rejects a 10 kHz tone (above 8 kHz output Nyquist)", () => {
    const inBuf = sine(10000, 24000, 4800);
    const ratio = centralRms(downsample24to16(inBuf)) / centralRms(inBuf);
    expect(ratio).toBeLessThan(0.12);
  });
});

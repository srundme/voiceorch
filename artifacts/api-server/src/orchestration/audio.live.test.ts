import { describe, expect, it } from "vitest";
import { downsample24to8, upsample8to16 } from "./audio.js";

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

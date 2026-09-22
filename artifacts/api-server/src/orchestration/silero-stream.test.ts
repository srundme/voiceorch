import { describe, expect, it } from "vitest";
import { appendAlignedPcm8k, SILERO_FRAME_8K_BYTES } from "./silero-stream.js";

function pcm(samples: number, fill = 1): Buffer {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) buf.writeInt16LE(fill, i * 2);
  return buf;
}

describe("appendAlignedPcm8k", () => {
  it("holds leftover when a WebSocket chunk is smaller than one Silero frame", () => {
    const first = appendAlignedPcm8k(Buffer.alloc(0), pcm(100));
    expect(first.frames8k).toHaveLength(0);
    expect(first.leftover.length).toBe(200);
  });

  it("emits exact 256-sample frames across misaligned chunks and keeps remainder", () => {
    let leftover = Buffer.alloc(0);
    const frames: Buffer[] = [];
    for (const samples of [80, 90, 200, 33]) {
      const next = appendAlignedPcm8k(leftover, pcm(samples));
      leftover = next.leftover;
      frames.push(...next.frames8k);
    }
    expect(frames.length).toBe(1);
    expect(frames[0]!.length).toBe(SILERO_FRAME_8K_BYTES);
    // 80+90+200+33 = 403 samples; one frame of 256 → leftover 147 samples.
    expect(leftover.length).toBe(147 * 2);
  });

  it("keeps an odd trailing byte until a later chunk completes the sample", () => {
    const odd = Buffer.from([0x11]);
    const first = appendAlignedPcm8k(Buffer.alloc(0), odd);
    expect(first.frames8k).toHaveLength(0);
    const second = appendAlignedPcm8k(first.leftover, Buffer.concat([Buffer.from([0x22]), pcm(255)]));
    expect(second.frames8k).toHaveLength(1);
    expect(second.frames8k[0]!.length).toBe(SILERO_FRAME_8K_BYTES);
    expect(second.leftover.length).toBe(0);
  });
});

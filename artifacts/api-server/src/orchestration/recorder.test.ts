import { describe, expect, it } from "vitest";
import { encodeCallRecordingWav } from "./recorder-encode.js";

function pcm16(samples: number[]): Buffer {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i]!, i * 2);
  return buf;
}

function readStereo(wav: Buffer): { left: number[]; right: number[] } {
  expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
  expect(wav.readUInt16LE(22)).toBe(2);
  const dataSize = wav.readUInt32LE(40);
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < dataSize; i += 4) {
    left.push(wav.readInt16LE(44 + i));
    right.push(wav.readInt16LE(44 + i + 2));
  }
  return { left, right };
}

describe("encodeCallRecordingWav", () => {
  it("puts the mixed caller+agent signal on both channels", () => {
    const wav = encodeCallRecordingWav(pcm16([1000, 0, 2000]), pcm16([0, 3000, 4000]), 8000);
    const { left, right } = readStereo(wav);
    expect(left).toEqual([1000, 3000, 6000]);
    expect(right).toEqual(left);
  });

  it("keeps a caller-only sample audible when the agent is silent", () => {
    const wav = encodeCallRecordingWav(pcm16([12000]), pcm16([]), 8000);
    const { left, right } = readStereo(wav);
    expect(left).toEqual([12000]);
    expect(right).toEqual([12000]);
  });

  it("keeps an agent-only sample audible when the caller is silent", () => {
    const wav = encodeCallRecordingWav(pcm16([]), pcm16([15000]), 8000);
    const { left, right } = readStereo(wav);
    expect(left).toEqual([15000]);
    expect(right).toEqual([15000]);
  });

  it("saturates instead of wrapping when both sides are loud", () => {
    const wav = encodeCallRecordingWav(pcm16([30000]), pcm16([20000]), 8000);
    const { left } = readStereo(wav);
    expect(left).toEqual([32767]);
  });
});

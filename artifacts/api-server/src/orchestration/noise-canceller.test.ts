import { describe, it, expect } from "vitest";
import { NoiseCanceller } from "./audio.js";

describe("speech-preserving noise filter", () => {
  it.each([100, 4000])("passes through PCM at amplitude %i without gating", (amplitude) => {
    const samples = Int16Array.from({ length: 16000 }, (_, i) =>
      Math.round(amplitude * Math.sin(2 * Math.PI * 1000 * i / 8000)));
    const bytes = Buffer.from(samples.buffer);
    const filter = new NoiseCanceller(4);
    const chunks: Buffer[] = [];
    for (let i = 0; i < bytes.length; i += 320) chunks.push(filter.process(bytes.subarray(i, i + 320)));
    expect(Buffer.concat(chunks)).toEqual(bytes);
  });

  it("does not attenuate quiet speech after a loud onset", () => {
    const samples = Int16Array.from({ length: 8000 }, (_, i) =>
      Math.round((i < 4000 ? 12000 : 100) * Math.sin(2 * Math.PI * 1000 * i / 8000)));
    const bytes = Buffer.from(samples.buffer);
    expect(new NoiseCanceller().process(bytes)).toEqual(bytes);
  });

  it("accepts unaligned Buffer views and rejects incomplete PCM samples", () => {
    const filter = new NoiseCanceller();
    expect(filter.process(Buffer.alloc(321).subarray(1))).toEqual(Buffer.alloc(320));
    expect(() => filter.process(Buffer.alloc(3))).toThrow("complete samples");
  });
});

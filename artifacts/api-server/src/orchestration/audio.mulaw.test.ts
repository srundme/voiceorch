import { describe, expect, it } from "vitest";
import { decodeMulaw, encodeMulaw, linearToMulaw, mulawToLinear } from "./audio.js";

describe("G.711 PCMU in the PCM16 domain", () => {
  it.each([
    [0xff, 0], [0x7f, 0], [0xfe, 8], [0x7e, -8],
    [0xf0, 120], [0xef, 132], [0xce, 988], [0x4e, -988],
    [0x80, 32124], [0x00, -32124],
  ])("decodes reference code %i to %i", (code, pcm) => {
    expect(mulawToLinear(code)).toBe(pcm);
  });

  it("round-trips every code, canonicalizing negative zero", () => {
    for (let code = 0; code < 256; code++) {
      expect(linearToMulaw(mulawToLinear(code))).toBe(code === 0x7f ? 0xff : code);
    }
  });

  it("preserves high-amplitude speech instead of clipping everything above 8k", () => {
    expect(linearToMulaw(32767)).toBe(0x80);
    expect(linearToMulaw(-32768)).toBe(0x00);
    for (const pcm of [1000, 8000, 16000, 24000, 32000]) {
      expect(Math.abs(mulawToLinear(linearToMulaw(pcm)) - pcm)).toBeLessThan(pcm * 0.04);
    }
  });

  it("keeps a buffer of carrier silence silent", () => {
    expect(decodeMulaw(Buffer.alloc(160, 0xff))).toEqual(Buffer.alloc(320));
    expect(encodeMulaw(Buffer.alloc(320))).toEqual(Buffer.alloc(160, 0xff));
  });
});

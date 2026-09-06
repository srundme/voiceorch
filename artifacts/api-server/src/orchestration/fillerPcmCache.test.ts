import { describe, expect, it, beforeEach } from "vitest";
import {
  clearFillerPcmCache,
  fillerPcmCacheSize,
  getCachedFillerPcm,
  setCachedFillerPcm,
} from "./fillerPcmCache.js";

describe("fillerPcmCache", () => {
  beforeEach(() => clearFillerPcmCache());

  it("stores and returns pcm by provider/voice/model/text", () => {
    const key = { provider: "cartesia", voice: "v1", model: "m", text: "One moment…" };
    expect(getCachedFillerPcm(key)).toBeNull();
    setCachedFillerPcm(key, Buffer.from([1, 2, 3, 4]));
    expect(getCachedFillerPcm(key)?.equals(Buffer.from([1, 2, 3, 4]))).toBe(true);
    expect(fillerPcmCacheSize()).toBe(1);
  });

  it("isolates different phrases", () => {
    setCachedFillerPcm(
      { provider: "cartesia", voice: "v1", model: "m", text: "hmm" },
      Buffer.from([9]),
    );
    expect(
      getCachedFillerPcm({ provider: "cartesia", voice: "v1", model: "m", text: "One moment…" }),
    ).toBeNull();
  });

  it("isolates 8 kHz and 16 kHz filler PCM", () => {
    const base = { provider: "cartesia", voice: "v1", model: "m", text: "ஆஹா" };
    setCachedFillerPcm({ ...base, sampleRate: 8000 }, Buffer.from([8]));
    expect(getCachedFillerPcm({ ...base, sampleRate: 16000 })).toBeNull();
    expect(getCachedFillerPcm({ ...base, sampleRate: 8000 })?.equals(Buffer.from([8]))).toBe(true);
  });
});

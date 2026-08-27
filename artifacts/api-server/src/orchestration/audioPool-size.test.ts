import { describe, expect, it } from "vitest";
import { cpus } from "os";
import { resolveAudioPoolSize } from "./audioPool.js";

describe("resolveAudioPoolSize", () => {
  it("caps default size on high CPU hosts (Railway-style)", () => {
    expect(resolveAudioPoolSize({}, 32)).toBe(8);
    expect(resolveAudioPoolSize({}, 16)).toBe(8);
  });

  it("uses at least 2 workers on tiny hosts", () => {
    expect(resolveAudioPoolSize({}, 1)).toBe(2);
    expect(resolveAudioPoolSize({}, 2)).toBe(2);
  });

  it("honors AUDIO_POOL_SIZE override", () => {
    expect(resolveAudioPoolSize({ AUDIO_POOL_SIZE: "4" }, 32)).toBe(4);
    expect(resolveAudioPoolSize({ AUDIO_POOL_SIZE: "12" }, 32)).toBe(12);
  });

  it("matches local machine within the default cap", () => {
    const n = resolveAudioPoolSize({}, cpus().length);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(8);
  });
});

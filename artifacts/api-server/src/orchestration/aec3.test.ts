import { describe, expect, it } from "vitest";
import {
  aec3Enabled,
  aec3StreamDelayMs,
  Aec3CallCanceller,
  AEC3_DELAY_MAX_MS,
  AEC3_DELAY_MIN_MS,
  AEC3_DELAY_STEP_MS,
  AEC3_MIN_CORR,
  ensureAec3Module,
  estimateDelayFrames,
} from "./aec3.js";

function tonePcm8k(freqHz: number, amp: number, samples: number, phase = 0): Buffer {
  const out = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const s = Math.sin(2 * Math.PI * freqHz * (i / 8000) + phase) * amp;
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2);
  }
  return out;
}

function energy(pcm: Buffer): number {
  let e = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    const s = pcm.readInt16LE(i) / 32768;
    e += s * s;
  }
  return e;
}

describe("aec3 env", () => {
  it("defaults on and parses off flags", () => {
    expect(aec3Enabled({})).toBe(true);
    expect(aec3Enabled({ AEC3_ENABLED: "0" })).toBe(false);
    expect(aec3Enabled({ AEC3_ENABLED: "false" })).toBe(false);
    expect(aec3Enabled({ AEC3_ENABLED: "1" })).toBe(true);
  });

  it("clamps stream delay to the canary-safe range", () => {
    expect(aec3StreamDelayMs({})).toBe(100);
    expect(aec3StreamDelayMs({ AEC3_STREAM_DELAY_MS: "80" })).toBe(80);
    expect(aec3StreamDelayMs({ AEC3_STREAM_DELAY_MS: "20" })).toBe(AEC3_DELAY_MIN_MS);
    expect(aec3StreamDelayMs({ AEC3_STREAM_DELAY_MS: "9999" })).toBe(AEC3_DELAY_MAX_MS);
    expect(AEC3_DELAY_MIN_MS).toBe(40);
    expect(AEC3_DELAY_MAX_MS).toBe(800);
    expect(AEC3_DELAY_STEP_MS).toBe(15);
    expect(AEC3_MIN_CORR).toBe(0.4);
  });
});

describe("estimateDelayFrames", () => {
  it("returns lag + score when correlation is clear", () => {
    const far: number[] = [];
    const near: number[] = [];
    for (let i = 0; i < 80; i++) {
      const e = i > 10 && i < 40 ? 1 : 0.01;
      far.push(e);
      near.push(i >= 15 && i < 45 ? 0.8 : 0.01); // ~5 frame lag
    }
    const est = estimateDelayFrames(far, near);
    expect(est).not.toBeNull();
    expect(est!.lagFrames).toBeGreaterThanOrEqual(3);
    expect(est!.lagFrames).toBeLessThanOrEqual(8);
    expect(est!.score).toBeGreaterThanOrEqual(AEC3_MIN_CORR);
  });

  it("rejects weak correlation below the confidence floor", () => {
    const far = Array.from({ length: 60 }, () => 0.5 + Math.random() * 0.01);
    const near = Array.from({ length: 60 }, () => 0.5 + Math.random() * 0.01);
    expect(estimateDelayFrames(far, near, 0.9)).toBeNull();
  });
});

describe("Aec3CallCanceller (VoBiz 8 kHz)", () => {
  it("loads WASM and attenuates loopback far-end echo", async () => {
    const warm = await ensureAec3Module();
    expect(warm).toEqual({ ok: true });

    const aec = new Aec3CallCanceller("test-vobiz-8k", {
      AEC3_ENABLED: "1",
      AEC3_STREAM_DELAY_MS: "40",
      AEC3_ADAPTIVE_DELAY: "0",
    });
    expect(await aec.init()).toBe(true);

    const frame = 160; // 20 ms @ 8 kHz
    let inE = 0;
    let outE = 0;
    for (let f = 0; f < 80; f++) {
      const far = tonePcm8k(440, 0.35, frame, f * 0.05);
      const echo = tonePcm8k(440, 0.2, frame, f * 0.05);
      const speech = tonePcm8k(220, f > 40 ? 0.12 : 0, frame);
      const near = Buffer.alloc(frame * 2);
      for (let i = 0; i < frame; i++) {
        const mix =
          echo.readInt16LE(i * 2) / 32768 + speech.readInt16LE(i * 2) / 32768;
        near.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mix)) * 32767), i * 2);
      }
      aec.analyzePcm8k(far);
      const cleaned = aec.processPcm8k(near);
      expect(cleaned.length).toBe(near.length);
      if (f >= 20 && f < 40) {
        inE += energy(near);
        outE += energy(cleaned);
      }
    }
    aec.dispose();
    expect(outE / inE).toBeLessThan(0.25);
  }, 15_000);

  it("reset clears correlation history and recreates AEC state", async () => {
    const warm = await ensureAec3Module();
    expect(warm).toEqual({ ok: true });

    const aec = new Aec3CallCanceller("test-reset-epoch", {
      AEC3_ENABLED: "1",
      AEC3_STREAM_DELAY_MS: "100",
    });
    expect(await aec.init()).toBe(true);
    const frame = tonePcm8k(440, 0.3, 160);
    for (let i = 0; i < 10; i++) {
      aec.analyzePcm8k(frame);
      aec.processPcm8k(frame);
    }
    aec.reset();
    const cleaned = aec.processPcm8k(frame);
    expect(cleaned.length).toBe(frame.length);
    aec.dispose();
  }, 15_000);
});

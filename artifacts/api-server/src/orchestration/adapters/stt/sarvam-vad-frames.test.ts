import { describe, expect, it } from "vitest";
import {
  DEFAULT_FIRST_TURN_MIN_SPEECH_MS,
  endOfSpeechFrames,
  msToVadFrames,
  resolveMsSetting,
  resolveOptionalMsSetting,
  vadFrameMs,
} from "./sarvam.js";

/**
 * A Sarvam VAD frame is a fixed 512 SAMPLES, so frame-count settings are worth
 * double the wall-clock time at 8kHz. Sarvam's first-turn default of 8 frames
 * therefore demanded ~512ms of continuous speech before the first segment of a
 * connection would open, and short replies ("Yes", "Okay") were dropped with no
 * speech_start and no transcript. Configuring in milliseconds removes the whole
 * class of bug: these tests pin that the conversion is rate-aware.
 */
describe("Sarvam VAD frame duration", () => {
  it("is 32ms at 16kHz and 64ms at 8kHz", () => {
    expect(vadFrameMs(16000)).toBe(32);
    expect(vadFrameMs(8000)).toBe(64);
  });
});

describe("msToVadFrames", () => {
  it("yields half as many frames at 8kHz for the same wall-clock window", () => {
    expect(msToVadFrames(256, 16000)).toBe(8);
    expect(msToVadFrames(256, 8000)).toBe(4);
  });

  // Frames are indivisible, so a requested window can only be met to the nearest
  // frame — at worst half a frame out (16ms at 16kHz, 32ms at 8kHz). Windows that
  // are whole multiples of 64ms land exactly on both paths.
  it("round-trips to within half a frame at both sample rates", () => {
    for (const ms of [64, 128, 256, 400, 512, 800]) {
      for (const rate of [8000, 16000] as const) {
        const realized = msToVadFrames(ms, rate) * vadFrameMs(rate);
        expect(Math.abs(realized - ms)).toBeLessThanOrEqual(vadFrameMs(rate) / 2);
      }
    }
  });

  it("is exact at both rates for multiples of 64ms", () => {
    for (const ms of [64, 128, 256, 512, 768]) {
      expect(msToVadFrames(ms, 16000) * vadFrameMs(16000)).toBe(ms);
      expect(msToVadFrames(ms, 8000) * vadFrameMs(8000)).toBe(ms);
    }
  });

  it("never returns zero frames, however small the window", () => {
    expect(msToVadFrames(1, 8000)).toBe(1);
    expect(msToVadFrames(0, 16000)).toBe(1);
  });
});

describe("first-turn window", () => {
  it("holds the same wall-clock window at both sample rates", () => {
    const at16k = msToVadFrames(DEFAULT_FIRST_TURN_MIN_SPEECH_MS, 16000) * vadFrameMs(16000);
    const at8k = msToVadFrames(DEFAULT_FIRST_TURN_MIN_SPEECH_MS, 8000) * vadFrameMs(8000);
    expect(at8k).toBe(at16k);
    expect(at8k).toBe(256);
  });

  it("leaves the 16kHz path on Sarvam's server default of 8 frames", () => {
    expect(msToVadFrames(DEFAULT_FIRST_TURN_MIN_SPEECH_MS, 16000)).toBe(8);
  });

  it("admits a short 300ms telephony reply that the raw server default would drop", () => {
    const shortReplyMs = 300;
    const ours = msToVadFrames(DEFAULT_FIRST_TURN_MIN_SPEECH_MS, 8000) * vadFrameMs(8000);
    const serverDefault = 8 * vadFrameMs(8000); // 8 frames read at 8kHz = 512ms
    expect(shortReplyMs).toBeGreaterThan(ours);
    expect(shortReplyMs).toBeLessThan(serverDefault);
  });
});

describe("endOfSpeechFrames", () => {
  it("produces the same silence window at both sample rates, within one frame", () => {
    const at16k = endOfSpeechFrames(400, 16000).count * vadFrameMs(16000);
    const at8k = endOfSpeechFrames(400, 8000).count * vadFrameMs(8000);
    expect(Math.abs(at16k - at8k)).toBeLessThanOrEqual(vadFrameMs(8000));
  });

  it("allows a tolerance window wider than the required silent frames", () => {
    const { count, window } = endOfSpeechFrames(400, 8000);
    expect(window).toBeGreaterThan(count);
  });

  it("mirrors Sarvam's own 18-of-24 tolerance ratio", () => {
    // 24 frames at 16kHz is 768ms; asking for 18 frames' worth of silence should
    // reproduce Sarvam's documented default pair.
    expect(endOfSpeechFrames(18 * 32, 16000)).toEqual({ count: 18, window: 24 });
  });

  it("lands between the two high_vad_sensitivity presets on telephony", () => {
    // ON is ~128ms (chops mid-utterance), OFF is ~1150ms+ (audible dead air).
    const chosen = endOfSpeechFrames(400, 8000).count * vadFrameMs(8000);
    expect(chosen).toBeGreaterThan(2 * vadFrameMs(8000));
    expect(chosen).toBeLessThan(18 * vadFrameMs(8000));
  });
});

describe("setting resolution", () => {
  const bounds = { min: 64, max: 2000 };

  it("prefers an explicit configured value", () => {
    expect(resolveMsSetting(300, "SARVAM_UNSET_ENV_FOR_TEST", 256, bounds)).toBe(300);
  });

  it("falls back to the default when nothing is configured", () => {
    expect(resolveMsSetting(undefined, "SARVAM_UNSET_ENV_FOR_TEST", 256, bounds)).toBe(256);
  });

  it("clamps out-of-range values instead of trusting them", () => {
    expect(resolveMsSetting(99999, "SARVAM_UNSET_ENV_FOR_TEST", 256, bounds)).toBe(2000);
    expect(resolveMsSetting(1, "SARVAM_UNSET_ENV_FOR_TEST", 256, bounds)).toBe(64);
  });

  it("reads a deploy-wide env override", () => {
    process.env.SARVAM_TEST_MS_OVERRIDE = "512";
    try {
      expect(resolveMsSetting(undefined, "SARVAM_TEST_MS_OVERRIDE", 256, bounds)).toBe(512);
    } finally {
      delete process.env.SARVAM_TEST_MS_OVERRIDE;
    }
  });

  it("keeps an optional setting unset so the provider default is untouched", () => {
    expect(resolveOptionalMsSetting(undefined, "SARVAM_UNSET_ENV_FOR_TEST", null, bounds)).toBeNull();
    expect(resolveOptionalMsSetting(null, "SARVAM_UNSET_ENV_FOR_TEST", null, bounds)).toBeNull();
  });

  // Agent config carries null for an unset field, so null must still fall through
  // to the env override rather than short-circuiting to "leave it alone".
  it("still honours the env override when the agent value is null", () => {
    process.env.SARVAM_TEST_OPTIONAL_MS = "400";
    try {
      expect(resolveOptionalMsSetting(null, "SARVAM_TEST_OPTIONAL_MS", null, bounds)).toBe(400);
      expect(resolveMsSetting(null, "SARVAM_TEST_OPTIONAL_MS", 256, bounds)).toBe(400);
    } finally {
      delete process.env.SARVAM_TEST_OPTIONAL_MS;
    }
  });

  it("enables an optional setting from env when no agent value exists", () => {
    process.env.SARVAM_TEST_OPTIONAL_MS = "400";
    try {
      expect(resolveOptionalMsSetting(undefined, "SARVAM_TEST_OPTIONAL_MS", null, bounds)).toBe(400);
    } finally {
      delete process.env.SARVAM_TEST_OPTIONAL_MS;
    }
  });
});

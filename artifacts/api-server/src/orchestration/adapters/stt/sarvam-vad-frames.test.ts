import { describe, expect, it } from "vitest";
import { firstTurnMinSpeechFrames, vadFrameMs } from "./sarvam.js";

/**
 * Guards the fix for lost first turns on 8kHz telephony. A Sarvam VAD frame is a
 * fixed 512 SAMPLES, so frame-count settings are worth double the wall-clock time
 * at 8kHz. Sarvam's default of 8 frames therefore demanded ~512ms of continuous
 * speech before the first speech segment of a connection would open, and short
 * replies ("Yes", "Okay") were dropped with no speech_start and no transcript.
 */
describe("Sarvam VAD frame duration", () => {
  it("is 32ms at 16kHz and 64ms at 8kHz", () => {
    expect(vadFrameMs(16000)).toBe(32);
    expect(vadFrameMs(8000)).toBe(64);
  });
});

describe("firstTurnMinSpeechFrames", () => {
  it("keeps the same first-turn window in milliseconds at both sample rates", () => {
    const at16k = firstTurnMinSpeechFrames(16000) * vadFrameMs(16000);
    const at8k = firstTurnMinSpeechFrames(8000) * vadFrameMs(8000);
    expect(at8k).toBe(at16k);
  });

  it("holds Sarvam's intended 256ms window rather than the doubled 512ms", () => {
    expect(firstTurnMinSpeechFrames(8000) * vadFrameMs(8000)).toBe(256);
  });

  it("leaves the 16kHz path on Sarvam's server default of 8 frames", () => {
    expect(firstTurnMinSpeechFrames(16000)).toBe(8);
  });

  it("admits a short 300ms telephony reply that the server default would drop", () => {
    const shortReplyMs = 300;
    expect(shortReplyMs).toBeGreaterThan(firstTurnMinSpeechFrames(8000) * vadFrameMs(8000));
    expect(shortReplyMs).toBeLessThan(8 * vadFrameMs(8000)); // the old default
  });
});

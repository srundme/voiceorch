import { describe, expect, it } from "vitest";
import { isRecognitionStalled } from "./sarvam.js";

/**
 * Call 5439 died with the zombie detector watching. Sarvam kept emitting
 * speech_start while its recognition engine produced nothing, and because every
 * inbound frame — VAD included — refreshed the socket-silence window, the
 * detector never fired. The caller got three silence reprompts and a
 * silence_timeout hangup.
 *
 * These tests pin the replacement signal and, just as importantly, the cases it
 * must NOT fire on: a false positive here terminates a healthy socket in the
 * middle of a sentence, which is worse than the bug being fixed.
 */
const DEAD_MS = 3_000;
const MIN_SEGMENTS = 2;

const stalled = (
  speechStartsSinceTranscript: number,
  awaitingTranscriptSince: number,
  nowMs: number,
): boolean =>
  isRecognitionStalled({
    speechStartsSinceTranscript,
    awaitingTranscriptSince,
    nowMs,
    deadMs: DEAD_MS,
    minSegments: MIN_SEGMENTS,
  });

describe("recognition stall detection", () => {
  it("does not fire when no transcript is pending", () => {
    expect(stalled(0, 0, 10_000)).toBe(false);
  });

  it("never fires on a single long utterance, however long it runs", () => {
    // Sarvam emits transcripts only at end-of-speech, so a caller talking
    // continuously for 30s legitimately produces one speech_start and silence.
    // A plain no-transcript timeout would have killed this socket at 3s.
    for (const elapsed of [3_001, 10_000, 30_000, 120_000]) {
      expect(stalled(1, 1_000, 1_000 + elapsed)).toBe(false);
    }
  });

  it("does not fire on repeated speech_starts before the dead threshold", () => {
    // A fast stutter or a quick self-correction reopens the segment twice within
    // a second. That is normal speech, not a stalled engine.
    expect(stalled(3, 1_000, 1_000 + DEAD_MS)).toBe(false);
  });

  it("fires once both repeated speech_starts and elapsed time are present", () => {
    expect(stalled(MIN_SEGMENTS, 1_000, 1_000 + DEAD_MS + 1)).toBe(true);
  });

  it("times the stall from the first silent speech_start, not the latest", () => {
    // The bug in one line: restarting the clock on each speech_start is exactly
    // what let the window stay open forever. Call 5439's real timeline —
    // speech_start at 27.4s, 31.4s, 35.7s, no transcript — must trip the
    // detector rather than survive to the reprompt ladder.
    const first = 27_426;
    expect(stalled(1, first, 31_450)).toBe(false); // one segment: still just a long utterance
    expect(stalled(2, first, 31_450)).toBe(true); // second speech_start, 4s in
    expect(stalled(3, first, 35_668)).toBe(true);
  });

  it("clears as soon as a transcript resets the counters", () => {
    // noteRecognitionAlive() zeroes both fields; the detector must go quiet even
    // though wall-clock time has advanced far past the threshold.
    expect(stalled(0, 0, 60_000)).toBe(false);
  });
});

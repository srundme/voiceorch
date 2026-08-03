import { describe, expect, it } from "vitest";
import { isRecognitionStalled, isTranscriptOverdue } from "./sarvam.js";

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
    // clearStallState() zeroes both fields; the detector must go quiet even
    // though wall-clock time has advanced far past the threshold.
    expect(stalled(0, 0, 60_000)).toBe(false);
  });
});

/**
 * Calls 5498/5499: the old detector terminated a socket after 3s of inbound
 * silence inside an OPEN speech segment. Sarvam sends nothing during an utterance,
 * so that put a hard three-second ceiling on how long a caller was allowed to
 * speak. Every utterance past ~3.1s was guillotined mid-sentence and its audio
 * destroyed; the longest survivor across both calls was 3078ms, and only because
 * speech_end beat the 300ms heartbeat tick.
 *
 * The invariant these tests defend: only speech_end may arm this check.
 */
describe("overdue transcript detection", () => {
  const overdue = (transcriptOwedSince: number, nowMs: number): boolean =>
    isTranscriptOverdue({ transcriptOwedSince, nowMs, deadMs: DEAD_MS });

  it("never fires while nothing is owed, no matter how long the caller talks", () => {
    // 0 is the state during an open speech segment. These are the real utterance
    // lengths that used to get their sockets killed.
    for (const elapsed of [3_050, 3_186, 3_230, 30_000]) {
      expect(overdue(0, elapsed)).toBe(false);
    }
  });

  it("does not fire before the threshold once speech_end lands", () => {
    expect(overdue(1_000, 1_000 + DEAD_MS)).toBe(false);
  });

  it("fires when speech_end came but the transcript never did", () => {
    expect(overdue(1_000, 1_000 + DEAD_MS + 1)).toBe(true);
  });
});

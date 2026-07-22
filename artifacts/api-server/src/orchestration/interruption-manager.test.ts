import { describe, it, expect, vi, afterEach } from "vitest";
import { FILLER_SEQUENCE_ID, InterruptionManager } from "./interruption-manager.js";

describe("InterruptionManager", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("beginAgentTurn returns monotonic sequence ids", () => {
    const m = new InterruptionManager();
    const a = m.beginAgentTurn();
    const b = m.beginAgentTurn();
    expect(b).toBe(a + 1);
    expect(m.isValidSequence(a)).toBe(true);
    expect(m.isValidSequence(b)).toBe(true);
  });

  it("invalidateCurrentTurn blocks stale audio for that sequence", () => {
    const m = new InterruptionManager();
    const id = m.beginAgentTurn();
    m.invalidateCurrentTurn();
    expect(m.isValidSequence(id)).toBe(false);
    expect(m.getAudioSendStatus(id, 5)).toBe("BLOCK");
  });

  it("filler sequence id is always valid", () => {
    const m = new InterruptionManager();
    m.beginAgentTurn();
    m.invalidateCurrentTurn();
    expect(m.isValidSequence(FILLER_SEQUENCE_ID)).toBe(true);
    expect(m.getAudioSendStatus(FILLER_SEQUENCE_ID, 5)).toBe("SEND");
  });

  it("WAIT while callee is speaking", () => {
    const m = new InterruptionManager();
    const id = m.beginAgentTurn();
    m.onUserSpeechStart();
    expect(m.getAudioSendStatus(id, 5)).toBe("WAIT");
    m.onUserSpeechEnd();
    expect(m.getAudioSendStatus(id, 5)).toBe("WAIT");
  });

  it("SEND after incremental delay elapses post-utterance", () => {
    vi.useFakeTimers();
    const m = new InterruptionManager({ incrementalDelayMs: 900 });
    const id = m.beginAgentTurn();
    m.onUserSpeechEnd();
    expect(m.getAudioSendStatus(id, 5)).toBe("WAIT");
    vi.advanceTimersByTime(900);
    expect(m.getAudioSendStatus(id, 5)).toBe("SEND");
  });

  it("skips incremental delay on welcome turns (historyLength <= 2)", () => {
    const m = new InterruptionManager({ incrementalDelayMs: 900 });
    const id = m.beginAgentTurn();
    m.onUserSpeechEnd();
    expect(m.getAudioSendStatus(id, 2)).toBe("SEND");
  });

  it("invalidateCurrentTurn clears all non-filler sequence ids", () => {
    const m = new InterruptionManager();
    const a = m.beginAgentTurn();
    const b = m.beginAgentTurn();
    m.invalidateCurrentTurn();
    expect(m.isValidSequence(a)).toBe(false);
    expect(m.isValidSequence(b)).toBe(false);
    expect(m.isValidSequence(FILLER_SEQUENCE_ID)).toBe(true);
  });

  it("pruneStaleSequences retains only current sequence and filler", () => {
    const m = new InterruptionManager();
    const a = m.beginAgentTurn();
    const b = m.beginAgentTurn();
    m.pruneStaleSequences();
    expect(m.isValidSequence(a)).toBe(false);
    expect(m.isValidSequence(b)).toBe(true);
    expect(m.isValidSequence(FILLER_SEQUENCE_ID)).toBe(true);
  });

  it("shouldTriggerInterruption respects word count and accidental interruption phrases", () => {
    const m = new InterruptionManager({ wordsForInterruption: 3 });

    // Not playing audio -> false
    expect(m.shouldTriggerInterruption(5, "one two three four five", false)).toBe(false);

    // Playing audio + word count < 3 -> false
    expect(m.shouldTriggerInterruption(2, "hello sir", true)).toBe(false);

    // Playing audio + word count >= 3 -> true
    expect(m.shouldTriggerInterruption(3, "one two three", true)).toBe(true);

    // Playing audio + keyword match ("stop", "wait", "நிறுத்து", "रुक") -> true even if 1 word
    expect(m.shouldTriggerInterruption(1, "stop", true)).toBe(true);
    expect(m.shouldTriggerInterruption(1, "நிறுத்து", true)).toBe(true);
    expect(m.shouldTriggerInterruption(1, "रुक", true)).toBe(true);
  });

  it("exposes wordsForInterruption from options", () => {
    expect(new InterruptionManager({ wordsForInterruption: 4 }).getWordsForInterruption()).toBe(4);
  });
});

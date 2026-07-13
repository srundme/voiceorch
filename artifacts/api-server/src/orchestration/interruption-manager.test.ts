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
    expect(m.isValidSequence(a)).toBe(true);
    expect(m.isValidSequence(b)).toBe(true);
    m.invalidateCurrentTurn();
    expect(m.isValidSequence(a)).toBe(false);
    expect(m.isValidSequence(b)).toBe(false);
    expect(m.isValidSequence(FILLER_SEQUENCE_ID)).toBe(true);
  });

  it("pruneStaleSequences keeps current and filler only", () => {
    const m = new InterruptionManager();
    const stale = m.beginAgentTurn();
    const current = m.beginAgentTurn();
    m.pruneStaleSequences();
    expect(m.isValidSequence(stale)).toBe(false);
    expect(m.isValidSequence(current)).toBe(true);
    expect(m.isValidSequence(FILLER_SEQUENCE_ID)).toBe(true);
  });

  it("exposes wordsForInterruption from options", () => {
    expect(new InterruptionManager({ wordsForInterruption: 4 }).getWordsForInterruption()).toBe(4);
  });
});

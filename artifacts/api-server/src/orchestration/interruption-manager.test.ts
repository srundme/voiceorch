import { describe, it, expect, vi, afterEach } from "vitest";
import {
  FILLER_SEQUENCE_ID,
  InterruptionManager,
  PLAYING_INTERRUPT_WORD_FLOOR,
} from "./interruption-manager.js";

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

  it("SEND while callee is speaking — STT barge cuts TTS, we do not pause the wire", () => {
    const m = new InterruptionManager();
    const id = m.beginAgentTurn();
    m.onUserSpeechStart();
    expect(m.getAudioSendStatus(id, 5)).toBe("SEND");
    m.onUserSpeechEnd();
    expect(m.getAudioSendStatus(id, 5)).toBe("SEND");
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

  it("interrupts only when word count meets the floor while TTS is playing", () => {
    const m = new InterruptionManager();
    expect(m.getWordsForInterruption()).toBe(PLAYING_INTERRUPT_WORD_FLOOR);
    expect(m.shouldTriggerInterruption(5, "one two three four five", false)).toBe(false);
    expect(m.shouldTriggerInterruption(1, "hello", true)).toBe(false);
    expect(m.shouldTriggerInterruption(2, "yes okay", true)).toBe(false);
    expect(m.shouldTriggerInterruption(1, "uh", true)).toBe(false);
    expect(m.shouldTriggerInterruption(1, "stop", true)).toBe(false);
    expect(m.shouldTriggerInterruption(3, "I want help", true)).toBe(true);
    expect(m.shouldTriggerInterruption(1, "", true)).toBe(false);
  });

  it("tracks calleeSpeaking", () => {
    const m = new InterruptionManager();
    expect(m.isCalleeSpeaking()).toBe(false);
    m.onUserSpeechStart();
    expect(m.isCalleeSpeaking()).toBe(true);
    m.onUserSpeechEnd();
    expect(m.isCalleeSpeaking()).toBe(false);
  });

  it("exposes wordsForInterruption from options", () => {
    expect(new InterruptionManager({ wordsForInterruption: 4 }).getWordsForInterruption()).toBe(4);
  });
});

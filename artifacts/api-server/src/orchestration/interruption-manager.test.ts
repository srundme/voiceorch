import { describe, it, expect, vi, afterEach } from "vitest";
import {
  FILLER_SEQUENCE_ID,
  InterruptionManager,
  bargeInMinChars,
  resolvePlayingWordFloor,
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

  it("filler still SEND while calleeSpeaking (echo VAD must not chop ம்ம்)", () => {
    const m = new InterruptionManager();
    m.beginAgentTurn();
    m.onUserSpeechStart();
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

  it("SEND after incremental delay elapses post-utterance", () => {
    vi.useFakeTimers();
    const m = new InterruptionManager({ incrementalDelayMs: 900 });
    const id = m.beginAgentTurn();
    m.onUserSpeechEnd();
    expect(m.getAudioSendStatus(id, 5)).toBe("SEND");
    vi.advanceTimersByTime(900);
    expect(m.getAudioSendStatus(id, 5)).toBe("SEND");
    vi.useRealTimers();
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

  it("interrupts on any nonempty STT while TTS is playing", () => {
    const m = new InterruptionManager();
    expect(m.shouldTriggerInterruption(5, "one two three four five", false)).toBe(false);
    expect(m.shouldTriggerInterruption(1, "hello", true)).toBe(true);
    expect(m.shouldTriggerInterruption(2, "yes okay", true)).toBe(true);
    expect(m.shouldTriggerInterruption(1, "uh", true)).toBe(true);
    expect(m.shouldTriggerInterruption(1, "stop", true)).toBe(true);
    expect(m.shouldTriggerInterruption(1, "", true)).toBe(false);
  });

  it("never labels a transcript as a false interruption", () => {
    const m = new InterruptionManager();
    expect(m.isFalseInterruption(1, "hmm", true)).toBe(false);
    expect(m.isFalseInterruption(8, "I want a bigger coverage plan", true)).toBe(false);
    expect(m.isFalseInterruption(1, "stop", true)).toBe(false);
    expect(m.isFalseInterruption(1, "Okay", false)).toBe(false);
  });

  it("tracks calleeSpeaking for coalesce deferral (call 4856)", () => {
    const m = new InterruptionManager();
    expect(m.isCalleeSpeaking()).toBe(false);
    m.onUserSpeechStart();
    expect(m.isCalleeSpeaking()).toBe(true);
    m.onUserSpeechEnd();
    expect(m.isCalleeSpeaking()).toBe(false);
  });

  it("exposes wordsForInterruption from options", () => {
    expect(new InterruptionManager({ wordsForInterruption: 4 }).getWordsForInterruption()).toBe(4);
    expect(resolvePlayingWordFloor({ transcript: "yes okay" })).toBe(PLAYING_INTERRUPT_WORD_FLOOR);
  });
});

describe("bargeInMinChars", () => {
  it("keeps the historic floors for callers that still read the helper", () => {
    expect(bargeInMinChars("en-IN")).toBe(4);
    expect(bargeInMinChars("hi-IN")).toBe(10);
    expect(bargeInMinChars(null)).toBe(4);
  });
});

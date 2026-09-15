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

  it("WAIT while callee is speaking", () => {
    const m = new InterruptionManager();
    const id = m.beginAgentTurn();
    m.onUserSpeechStart();
    expect(m.getAudioSendStatus(id, 5)).toBe("WAIT");
    m.onUserSpeechEnd();
    expect(m.getAudioSendStatus(id, 5)).toBe("SEND");
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

  it("shouldTriggerInterruption uses Bolna's 3-word floor while TTS plays", () => {
    const m = new InterruptionManager();
    expect(m.getWordsForInterruption()).toBe(PLAYING_INTERRUPT_WORD_FLOOR);

    expect(m.shouldTriggerInterruption(5, "one two three four five", false)).toBe(false);
    expect(m.shouldTriggerInterruption(1, "hello", true)).toBe(false);
    expect(m.shouldTriggerInterruption(2, "yes okay", true)).toBe(false);
    expect(m.shouldTriggerInterruption(1, "uh", true)).toBe(false);
    expect(m.shouldTriggerInterruption(2, "uh yes", true)).toBe(false);
    expect(m.shouldTriggerInterruption(3, "one two three", true)).toBe(false);
    expect(m.shouldTriggerInterruption(4, "one two three four", true)).toBe(true);

    expect(m.shouldTriggerInterruption(1, "stop", true)).toBe(true);
    expect(m.shouldTriggerInterruption(1, "நிறுத்து", true)).toBe(true);
    expect(m.shouldTriggerInterruption(1, "रुक", true)).toBe(true);
    expect(m.shouldTriggerInterruption(3, "wait stop இருங்க", true)).toBe(true);
  });

  it("preserves finalized short speech instead of using the speculative word floor to discard it", () => {
    const m = new InterruptionManager();
    // Short chatter while TTS plays — ignore, do not queue for later.
    for (const text of ["Okay", "ஆமா ஆமா", "ஆ", "uh huh", "No thanks", "Not interested", "I am busy", "no", "வேண்டாம்", "42"]) {
      expect(m.isFalseInterruption(text.split(" ").length, text, true)).toBe(false);
    }
    expect(m.isFalseInterruption(1, "hmm", true)).toBe(true);
    // Real utterance while TTS plays — interrupt now.
    expect(m.isFalseInterruption(8, "I want a bigger coverage plan", true)).toBe(false);
    expect(m.shouldTriggerInterruption(8, "I want a bigger coverage plan", true)).toBe(true);
    // Stop/wait still cut even at 1 word.
    expect(m.isFalseInterruption(1, "stop", true)).toBe(false);
    // Nothing playing → ordinary turn, neither verdict.
    expect(m.isFalseInterruption(1, "Okay", false)).toBe(false);
    expect(m.shouldTriggerInterruption(1, "Okay", false)).toBe(false);
    // Welcome not played → neither.
    expect(m.isFalseInterruption(8, "a long sentence here", true, false)).toBe(false);
  });

  it("the two Bolna verdicts never both hold", () => {
    const m = new InterruptionManager();
    for (const [words, text] of [
      [8, "a genuinely long request"],
      [2, "uh huh"],
      [1, "stop"],
    ] as const) {
      const triggers = m.shouldTriggerInterruption(words, text, true, true);
      const ignored = m.isFalseInterruption(words, text, true, true);
      expect(triggers && ignored).toBe(false);
    }
  });

  it("first-speech mute ignores every transcript including stop (Bolna welcome_played)", () => {
    const m = new InterruptionManager();
    expect(m.shouldTriggerInterruption(1, "Hello", true, false)).toBe(false);
    expect(m.shouldTriggerInterruption(3, "Hello இங்க பாருங்க", true, false)).toBe(false);
    expect(m.shouldTriggerInterruption(2, "yes okay", true, false)).toBe(false);
    expect(m.shouldTriggerInterruption(1, "wait", true, false)).toBe(false);
    expect(m.shouldTriggerInterruption(3, "wait stop இருங்க", true, false)).toBe(false);
  });

  it("uses the configured Bolna floor with no messy/+1 bump", () => {
    expect(resolvePlayingWordFloor({ transcript: "yes okay" })).toBe(PLAYING_INTERRUPT_WORD_FLOOR);
    expect(resolvePlayingWordFloor({ transcript: "uh yes" })).toBe(PLAYING_INTERRUPT_WORD_FLOOR);
    expect(resolvePlayingWordFloor({ transcript: "Hello", lowConfidence: true })).toBe(PLAYING_INTERRUPT_WORD_FLOOR);
  });

  it("exposes wordsForInterruption from options", () => {
    expect(new InterruptionManager({ wordsForInterruption: 4 }).getWordsForInterruption()).toBe(4);
  });

  it("tracks calleeSpeaking for coalesce deferral (call 4856)", () => {
    const m = new InterruptionManager();
    expect(m.isCalleeSpeaking()).toBe(false);
    m.onUserSpeechStart();
    expect(m.isCalleeSpeaking()).toBe(true);
    m.onUserSpeechEnd();
    expect(m.isCalleeSpeaking()).toBe(false);
  });
});

describe("bargeInMinChars", () => {
  it("keeps the 4-grapheme floor for English", () => {
    expect(bargeInMinChars("en-IN")).toBe(4);
    expect(bargeInMinChars("en")).toBe(4);
    expect(bargeInMinChars(null)).toBe(4);
  });

  it("raises the floor for Hindi and other Indic langs so short talk-over cannot cut TTS", () => {
    expect(bargeInMinChars("hi-IN")).toBe(10);
    expect(bargeInMinChars("ta-IN")).toBe(10);
    expect(bargeInMinChars("te")).toBe(10);
    // Call 10544 scraps that must stay under the floor
    expect([..."दरअसल"].length).toBeLessThan(bargeInMinChars("hi-IN"));
    expect([..."Okay"].length).toBeLessThan(bargeInMinChars("hi-IN"));
    expect([..."यू नो।"].length).toBeLessThan(bargeInMinChars("hi-IN"));
    // A real Hindi question still clears it
    expect([..."आप कौन हो?"].length).toBeGreaterThanOrEqual(bargeInMinChars("hi-IN"));
  });
});

import { describe, expect, it } from "vitest";
import { CALL_ENGINE_SAFE } from "../../../../lib/db/src/call-engine-defaults.js";
import { shouldBargeOnRealtimeVadStart } from "./adapters/stt/sarvam-realtime.js";
import {
  InterruptionManager,
  PLAYING_INTERRUPT_WORD_FLOOR,
  resolvePlayingWordFloor,
} from "./interruption-manager.js";
import {
  shouldCutTtsFromCallerTranscript,
  shouldDiscardOpenerTranscript,
} from "./pstn-interrupt-policy.js";

/**
 * Call 20257: greeting on the wire → PSTN echo / room speech → Sarvam VAD →
 * empty or leftover partial → must not cut TTS and must not processTurn.
 */
function decide20257(transcript: string, opts?: {
  greetingPlaying?: boolean;
  inEchoGrace?: boolean;
  isSelfEcho?: boolean;
}) {
  const interruptionMgr = new InterruptionManager();
  const greetingPlaying = opts?.greetingPlaying ?? true;
  const cutTts = shouldCutTtsFromCallerTranscript({
    transcript,
    agentSpeaking: true,
    greetingPlaybackActive: greetingPlaying,
    inEchoGrace: opts?.inEchoGrace,
    isSelfEcho: opts?.isSelfEcho,
    interruptionMgr,
  });
  const processTurn = greetingPlaying
    ? !shouldDiscardOpenerTranscript(transcript, interruptionMgr)
    : transcript.trim().length > 0;
  return { cutTts, processTurn };
}

describe("Bolna interrupt policy — 3-word default", () => {
  it("uses Bolna number_of_words_for_interruption = 3", () => {
    expect(PLAYING_INTERRUPT_WORD_FLOOR).toBe(3);
    expect(CALL_ENGINE_SAFE.wordsForInterruption).toBe(3);
    expect(new InterruptionManager().getWordsForInterruption()).toBe(3);
    expect(resolvePlayingWordFloor({ transcript: "yes okay" })).toBe(3);
    expect(resolvePlayingWordFloor({ transcript: "uh yes" })).toBe(3);
  });
});

describe("call 20257 — greeting + VAD + empty/partial must not start a turn", () => {
  it("speech_start with no transcript does not cut TTS or processTurn", () => {
    expect(shouldBargeOnRealtimeVadStart({
      agentSpeaking: true,
      greetingOrSystem: true,
      inEchoGrace: false,
      hasUsablePartial: false,
    })).toBe(false);
    expect(decide20257("")).toEqual({ cutTts: false, processTurn: false });
  });

  it("speech_start + Hello during the opener is ignored", () => {
    expect(decide20257("Hello")).toEqual({ cutTts: false, processTurn: false });
    expect(decide20257("Hello Madam")).toEqual({ cutTts: false, processTurn: false });
  });

  it("speech_start + room leftover during the opener is ignored", () => {
    expect(decide20257("Hello இங்க பாருங்க")).toEqual({ cutTts: false, processTurn: false });
  });

  it("yes / okay okay never cut TTS (answers, not barges)", () => {
    expect(decide20257("yes", { greetingPlaying: false }))
      .toEqual({ cutTts: false, processTurn: true });
    expect(decide20257("Yes, yes.", { greetingPlaying: false }))
      .toEqual({ cutTts: false, processTurn: true });
    expect(decide20257("Okay, okay", { greetingPlaying: false }))
      .toEqual({ cutTts: false, processTurn: true });
    expect(decide20257("Okay, okay, one minute", { greetingPlaying: false }))
      .toEqual({ cutTts: true, processTurn: true });
  });

  it("speech_start + yes okay stays below the Bolna 3-word floor", () => {
    expect(decide20257("yes okay")).toEqual({ cutTts: false, processTurn: false });
    expect(decide20257("yes okay", { greetingPlaying: false }))
      .toEqual({ cutTts: false, processTurn: true });
    expect(decide20257("yes okay continue", { greetingPlaying: false }))
      .toEqual({ cutTts: false, processTurn: true });
    expect(decide20257("yes okay continue please", { greetingPlaying: false }))
      .toEqual({ cutTts: true, processTurn: true });
  });

  it("speech_start + wait/stop during the opener does not cut (Bolna welcome_played)", () => {
    expect(decide20257("wait stop இருங்க")).toEqual({ cutTts: false, processTurn: false });
  });

  it("cuts TTS when the caller talks over a new clip with more than 3 words", () => {
    expect(decide20257("Start continue please now", { greetingPlaying: false }))
      .toEqual({ cutTts: true, processTurn: true });
    expect(decide20257("Hello, hello, are you there?", { greetingPlaying: false }))
      .toEqual({ cutTts: true, processTurn: true });
  });
});


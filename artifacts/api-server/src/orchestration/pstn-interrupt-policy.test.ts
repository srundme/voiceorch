import { describe, expect, it } from "vitest";
import { CALL_ENGINE_SAFE } from "../../../../lib/db/src/call-engine-defaults.js";
import { shouldBargeOnRealtimeVadStart } from "./adapters/stt/sarvam-realtime.js";
import {
  InterruptionManager,
  PLAYING_INTERRUPT_WORD_FLOOR,
  AMBIGUOUS_INTERRUPT_WORD_FLOOR,
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

describe("PSTN interrupt policy — keep a 2-word default", () => {
  it("does not raise the global floor to 3", () => {
    expect(PLAYING_INTERRUPT_WORD_FLOOR).toBe(2);
    expect(CALL_ENGINE_SAFE.wordsForInterruption).toBe(2);
    expect(new InterruptionManager().getWordsForInterruption()).toBe(2);
    expect(resolvePlayingWordFloor({ transcript: "yes okay" })).toBe(2);
    expect(resolvePlayingWordFloor({ transcript: "uh yes" })).toBe(AMBIGUOUS_INTERRUPT_WORD_FLOOR);
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

  it("speech_start + yes okay evaluates after the opener at the 2-word floor", () => {
    expect(decide20257("yes okay")).toEqual({ cutTts: false, processTurn: false });
    expect(decide20257("yes okay", { greetingPlaying: false }))
      .toEqual({ cutTts: true, processTurn: true });
  });

  it("speech_start + wait/stop/இருங்க is an immediate interrupt even during the opener", () => {
    expect(decide20257("wait stop இருங்க")).toEqual({ cutTts: true, processTurn: true });
  });
});

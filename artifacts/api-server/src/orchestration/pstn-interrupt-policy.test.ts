import { describe, expect, it } from "vitest";
import { shouldBargeOnRealtimeVadStart } from "./adapters/stt/sarvam-realtime.js";
import { InterruptionManager } from "./interruption-manager.js";
import {
  shouldAbandonStuckBarge,
  shouldCutTtsFromCallerTranscript,
  shouldDiscardOpenerTranscript,
  BARGE_STUCK_RESUME_MS,
} from "./pstn-interrupt-policy.js";

function decide(transcript: string, opts?: { greetingPlaying?: boolean }) {
  const interruptionMgr = new InterruptionManager();
  const greetingPlaying = opts?.greetingPlaying ?? true;
  const cutTts = shouldCutTtsFromCallerTranscript({
    transcript,
    agentSpeaking: true,
    greetingPlaybackActive: greetingPlaying,
    interruptionMgr,
  });
  const processTurn = !shouldDiscardOpenerTranscript(transcript, interruptionMgr);
  return { cutTts, processTurn };
}

describe("interrupt policy — trust STT text", () => {
  it("speech_start with no transcript does not cut TTS or processTurn", () => {
    expect(shouldBargeOnRealtimeVadStart({
      agentSpeaking: true,
      greetingOrSystem: true,
      inEchoGrace: false,
      hasUsablePartial: false,
    })).toBe(false);
    expect(decide("")).toEqual({ cutTts: false, processTurn: false });
  });

  it("any nonempty STT while the agent is speaking cuts TTS", () => {
    expect(decide("Hello")).toEqual({ cutTts: true, processTurn: true });
    expect(decide("yes", { greetingPlaying: false })).toEqual({ cutTts: true, processTurn: true });
    expect(decide("yes okay")).toEqual({ cutTts: true, processTurn: true });
    expect(decide("wait")).toEqual({ cutTts: true, processTurn: true });
  });

  it("does not second-guess far-field RMS", () => {
    const interruptionMgr = new InterruptionManager();
    const base = {
      transcript: "Start continue please now",
      agentSpeaking: true,
      greetingPlaybackActive: false,
      interruptionMgr,
      minBargeRms: 900,
    };
    expect(shouldCutTtsFromCallerTranscript({ ...base, peakRawRms: 200 })).toBe(true);
    expect(shouldCutTtsFromCallerTranscript({ ...base, peakRawRms: 1800 })).toBe(true);
  });

  it("never abandons a barge as stuck room chatter", () => {
    expect(BARGE_STUCK_RESUME_MS).toBe(Number.POSITIVE_INFINITY);
    expect(shouldAbandonStuckBarge({ bargeAgeMs: 800 })).toBe(false);
    expect(shouldAbandonStuckBarge({ bargeAgeMs: 3500 })).toBe(false);
  });
});

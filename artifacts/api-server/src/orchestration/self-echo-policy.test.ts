import { describe, expect, it } from "vitest";
import { shouldIgnoreSelfEcho } from "./self-echo-policy.js";

describe("Bolna self-echo", () => {
  it("welcome_played=false mutes the first utterance except stop/wait", () => {
    expect(shouldIgnoreSelfEcho({
      transcript: "Hello",
      agentSpeaking: true,
      welcomePlayed: false,
      isOverridePhrase: false,
    })).toEqual({ ignore: true, reason: "bolna_welcome" });

    expect(shouldIgnoreSelfEcho({
      transcript: "wait",
      agentSpeaking: true,
      welcomePlayed: false,
      isOverridePhrase: true,
    }).ignore).toBe(false);
  });

  it("ignores below the 3-word floor while the agent is speaking", () => {
    expect(shouldIgnoreSelfEcho({
      transcript: "yes okay",
      agentSpeaking: true,
      welcomePlayed: true,
      isOverridePhrase: false,
      wordFloor: 3,
    })).toEqual({ ignore: true, reason: "bolna_word_floor" });

    expect(shouldIgnoreSelfEcho({
      transcript: "yes okay continue",
      agentSpeaking: true,
      welcomePlayed: true,
      isOverridePhrase: false,
      wordFloor: 3,
    }).ignore).toBe(false);
  });

  it("after the agent stops, the floor is 0 — no TTS text matching", () => {
    expect(shouldIgnoreSelfEcho({
      transcript: "I am calling from the travel desk",
      agentSpeaking: false,
      welcomePlayed: true,
      isOverridePhrase: false,
      wordFloor: 3,
    })).toEqual({ ignore: false, reason: "none" });
  });
});

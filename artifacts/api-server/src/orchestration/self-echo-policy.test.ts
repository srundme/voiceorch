import { describe, expect, it } from "vitest";
import { shouldIgnoreSelfEcho } from "./self-echo-policy.js";

describe("Bolna self-echo", () => {
  it("rejects substantial matching output, but not a short answer or stop", () => {
    const base = { agentSpeaking: true, welcomePlayed: false, isOverridePhrase: false,
      recentAgentText: ["Hello I am calling from the travel desk."] };
    expect(shouldIgnoreSelfEcho({ ...base, transcript: "I am calling from the travel desk" }).ignore).toBe(true);
    expect(shouldIgnoreSelfEcho({ ...base, transcript: "Hello" }).ignore).toBe(false);
    expect(shouldIgnoreSelfEcho({ ...base, transcript: "stop", isOverridePhrase: true }).ignore).toBe(false);
  });
  it("welcome state alone never mutes caller speech or stop", () => {
    expect(shouldIgnoreSelfEcho({
      transcript: "Hello",
      agentSpeaking: true,
      welcomePlayed: false,
      isOverridePhrase: false,
    })).toEqual({ ignore: false, reason: "none" });

    expect(shouldIgnoreSelfEcho({
      transcript: "wait",
      agentSpeaking: true,
      welcomePlayed: false,
      isOverridePhrase: true,
    }).ignore).toBe(false);
  });

  it("does not drop one-word answers while the agent is speaking", () => {
    expect(shouldIgnoreSelfEcho({
      transcript: "yes",
      agentSpeaking: true,
      welcomePlayed: true,
      isOverridePhrase: false,
      wordFloor: 3,
    })).toEqual({ ignore: false, reason: "none" });

    expect(shouldIgnoreSelfEcho({
      transcript: "okay",
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

  it("rejects near-miss suffixes from the agent's own recent speech", () => {
    expect(shouldIgnoreSelfEcho({
      transcript: "our time",
      agentSpeaking: true,
      welcomePlayed: true,
      isOverridePhrase: false,
      recentAgentText: ["Sure, take your time."],
      wordFloor: 3,
    })).toEqual({ ignore: true, reason: "content_match" });
  });
});

import { describe, expect, it } from "vitest";
import { looksLikeVoicemailTranscript, looksLikeVoicemailGreeting, shouldMarkCallVoicemail } from "./voicemail-detect.js";

describe("looksLikeVoicemailGreeting", () => {
  it("detects carrier greetings without Voice mail prefix (call 14446)", () => {
    expect(looksLikeVoicemailGreeting(
      "The person you're trying to reach is not available. At the tone, please record your message. When you have finished recording you may hang up.",
    )).toBe(true);
  });

  it("ignores normal caller speech", () => {
    expect(looksLikeVoicemailGreeting("Hello, who is this?")).toBe(false);
  });
});

describe("looksLikeVoicemailTranscript", () => {
  it("detects classic greeting + agent ack (call 14439)", () => {
    const transcript = [
      "Voice mail. The person you're trying to reach is not available. At the tone, please record your message.",
      "Seems like I reached the voicemail. I'll try calling again later, Murali. Take care!",
    ].join("\n");
    expect(looksLikeVoicemailTranscript(transcript)).toBe(true);
  });

  it("does not flag a normal completed conversation", () => {
    expect(
      looksLikeVoicemailTranscript(
        "Hello, this is Ram. Sure, tomorrow at 10 works for me. Thank you, goodbye.",
      ),
    ).toBe(false);
  });
});

describe("shouldMarkCallVoicemail", () => {
  it("honors AMD machine and executed voicemail action", () => {
    expect(shouldMarkCallVoicemail({ voicemailActionExecuted: true })).toBe(true);
    expect(shouldMarkCallVoicemail({
      voicemailActionExecuted: false,
      amdResult: "machine",
    })).toBe(true);
    expect(shouldMarkCallVoicemail({
      voicemailActionExecuted: false,
      amdResult: "human",
      transcript: "Hello how are you",
    })).toBe(false);
  });
});

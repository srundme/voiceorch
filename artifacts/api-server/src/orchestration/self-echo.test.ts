import { describe, it, expect } from "vitest";
import { isSelfEcho, SELF_ECHO_MIN_WORDS, type RecentAgentLine } from "./self-echo.js";

const words = (s: string): string[] => s.toLowerCase().split(/\s+/).filter(Boolean);
const spoken = (...lines: string[]): RecentAgentLine[] =>
  lines.map((line) => ({ tokens: new Set(words(line)) }));

describe("isSelfEcho", () => {
  const agentLine = "hello i am calling from snapserve about the international voice process role";

  it("drops the agent's own sentence echoed back while it is speaking", () => {
    expect(isSelfEcho({
      tokens: words(agentLine),
      recentAgentSpeech: spoken(agentLine),
      agentAudible: true,
    })).toBe(true);
  });

  it("drops a degraded echo that STT mangled", () => {
    // Carrier echo loses words and inflections; an exact match would miss it.
    expect(isSelfEcho({
      tokens: words("i am calling from snapserve about the international voice process"),
      recentAgentSpeech: spoken(agentLine),
      agentAudible: true,
    })).toBe(true);
  });

  it("keeps everything once our audio is no longer on the leg", () => {
    expect(isSelfEcho({
      tokens: words(agentLine),
      recentAgentSpeech: spoken(agentLine),
      agentAudible: false,
    })).toBe(false);
  });

  it("keeps short caller answers even when their words are all in the agent line", () => {
    for (const reply of ["yes", "okay", "voice process", "the international voice"]) {
      expect(isSelfEcho({
        tokens: words(reply),
        recentAgentSpeech: spoken(agentLine),
        agentAudible: true,
      })).toBe(false);
    }
  });

  it("keeps a real caller talking over the agent so barge-in still fires", () => {
    expect(isSelfEcho({
      tokens: words("sorry i am not interested in this job right now"),
      recentAgentSpeech: spoken(agentLine),
      agentAudible: true,
    })).toBe(false);
  });

  it("keeps a caller answer that only partly reuses the agent's wording", () => {
    expect(isSelfEcho({
      tokens: words("i have two years of experience in voice process"),
      recentAgentSpeech: spoken(agentLine),
      agentAudible: true,
    })).toBe(false);
  });

  it("matches against any recently spoken line, not just the newest", () => {
    expect(isSelfEcho({
      tokens: words("what is your current city of residence"),
      recentAgentSpeech: spoken(
        "what is your current city of residence",
        "and how many companies have you worked at",
      ),
      agentAudible: true,
    })).toBe(true);
  });

  it("never matches with no agent speech on record", () => {
    expect(isSelfEcho({
      tokens: words(agentLine),
      recentAgentSpeech: [],
      agentAudible: true,
    })).toBe(false);
  });

  it("treats the word floor as inclusive", () => {
    const line = "one two three four five";
    expect(words(line).length).toBeGreaterThan(SELF_ECHO_MIN_WORDS);
    expect(isSelfEcho({
      tokens: words("one two three four"),
      recentAgentSpeech: spoken(line),
      agentAudible: true,
    })).toBe(true);
    expect(isSelfEcho({
      tokens: words("one two three"),
      recentAgentSpeech: spoken(line),
      agentAudible: true,
    })).toBe(false);
  });

  it("drops short zero-overlap STT junk while TTS is on the wire (call 25295)", () => {
    for (const scrap of ["Camera", "Downward", "Meeting பைங்கா"]) {
      expect(isSelfEcho({
        tokens: words(scrap),
        recentAgentSpeech: spoken(agentLine),
        agentAudible: true,
        ttsOnWire: true,
      })).toBe(true);
    }
  });

  it("keeps a city-name answer after TTS has finished (echo tail, not on the wire)", () => {
    expect(isSelfEcho({
      tokens: words("Chennai"),
      recentAgentSpeech: spoken(agentLine),
      agentAudible: true,
      ttsOnWire: false,
    })).toBe(false);
  });
});

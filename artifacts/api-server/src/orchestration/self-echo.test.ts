import { describe, it, expect } from "vitest";
import {
  isSelfEcho,
  isTtsOnWireForEcho,
  SELF_ECHO_MIN_WORDS,
  type RecentAgentLine,
} from "./self-echo.js";

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

  it("drops a 3-word greeting echo while TTS is on the wire (QA 28437)", () => {
    expect(isSelfEcho({
      tokens: words("calling from snapserve"),
      recentAgentSpeech: spoken(agentLine),
      agentAudible: true,
      ttsOnWire: true,
    })).toBe(true);
  });

  it("keeps a 3-word caller answer that only partly overlaps", () => {
    expect(isSelfEcho({
      tokens: words("chennai tamil nadu"),
      recentAgentSpeech: spoken(agentLine),
      agentAudible: true,
      ttsOnWire: true,
    })).toBe(false);
  });

  it("drops short zero-overlap STT junk while TTS is on the wire (call 25295)", () => {
    for (const scrap of ["Camera", "Downward"]) {
      expect(isSelfEcho({
        tokens: words(scrap),
        recentAgentSpeech: spoken(agentLine),
        agentAudible: true,
        ttsOnWire: true,
      })).toBe(true);
    }
  });

  it("keeps a caller who repeats the agent's words back as an answer (call 42585)", () => {
    expect(isSelfEcho({
      tokens: words("ठीक रहेगा madam ठीक रहेगा"),
      recentAgentSpeech: spoken("तो saturday सुबह ग्यारह बजे site visit ठीक रहेगा"),
      agentAudible: true,
    })).toBe(false);
  });

  it("keeps a 3-word zero-overlap answer while TTS is on the wire", () => {
    expect(isSelfEcho({
      tokens: words("Meeting பைங்கா now"),
      recentAgentSpeech: spoken(agentLine),
      agentAudible: true,
      ttsOnWire: true,
    })).toBe(false);
  });

  it("never drops a protected short caller intent while TTS is on the wire", () => {
    for (const reply of ["stop", "wrong number", "call me later", "thank you", "avvalavutha madam"]) {
      expect(isSelfEcho({
        tokens: words(reply),
        recentAgentSpeech: spoken(agentLine),
        agentAudible: true,
        ttsOnWire: true,
        protectedShortIntent: true,
      })).toBe(false);
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

  it("drops Latin STT hallucination of Indic TTS while the agent is speaking (call 26668)", () => {
    const tamilLine = "okay உங்க business-க்கு இப்போ funds தேவைப்படுதா";
    expect(isSelfEcho({
      tokens: words("There's the lamb, the lamb."),
      recentAgentSpeech: spoken(tamilLine),
      agentAudible: true,
      ttsOnWire: true,
    })).toBe(true);
    expect(isSelfEcho({
      tokens: words("There's the lamb, the"),
      recentAgentSpeech: spoken(tamilLine),
      agentAudible: true,
      ttsOnWire: true,
    })).toBe(true);
  });

  it("keeps a longer English barge over Tamil TTS so bilingual callers can interrupt", () => {
    expect(isSelfEcho({
      tokens: words("sorry i am not interested in this job right now"),
      recentAgentSpeech: spoken("okay உங்க business-க்கு இப்போ funds தேவைப்படுதா"),
      agentAudible: true,
      ttsOnWire: true,
    })).toBe(false);
  });

  it("keeps the Latin hallucination once TTS is no longer on the wire", () => {
    expect(isSelfEcho({
      tokens: words("There's the lamb, the lamb."),
      recentAgentSpeech: spoken("okay உங்க business-க்கு இப்போ funds தேவைப்படுதா"),
      agentAudible: true,
      ttsOnWire: false,
    })).toBe(false);
  });
});

describe("isTtsOnWireForEcho", () => {
  const tailMs = 2000;

  it("is on the wire while playback or TTS send is live", () => {
    expect(isTtsOnWireForEcho({
      isPlaying: true, isSendingTtsAudio: false, bargeInRequested: false,
      msSinceLastTtsFrame: 10_000, tailMs,
    })).toBe(true);
    expect(isTtsOnWireForEcho({
      isPlaying: false, isSendingTtsAudio: true, bargeInRequested: false,
      msSinceLastTtsFrame: 10_000, tailMs,
    })).toBe(true);
  });

  it("treats a just-cut barge as still on the wire for the echo tail (call 25295)", () => {
    expect(isTtsOnWireForEcho({
      isPlaying: false, isSendingTtsAudio: false, bargeInRequested: true,
      msSinceLastTtsFrame: 400, tailMs,
    })).toBe(true);
  });

  it("does not treat a sticky barge flag as TTS on the wire (call 26668)", () => {
    expect(isTtsOnWireForEcho({
      isPlaying: false, isSendingTtsAudio: false, bargeInRequested: true,
      msSinceLastTtsFrame: 17_000, tailMs,
    })).toBe(false);
    expect(isTtsOnWireForEcho({
      isPlaying: false, isSendingTtsAudio: false, bargeInRequested: true,
      msSinceLastTtsFrame: 2000, tailMs,
    })).toBe(false);
  });
});

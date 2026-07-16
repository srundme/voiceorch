import { describe, it, expect } from "vitest";
import {
  parseVibeGeminiJson,
  parseVoicePick,
  looksLikePhoneAssign,
  looksLikePhoneSkip,
  replyAsksCallFlow,
} from "./vibe-gemini-parse.js";

describe("parseVibeGeminiJson", () => {
  it("parses bare JSON", () => {
    const raw = JSON.stringify({
      reply: "Great — what's your company called?",
      phase: "core",
      ready: false,
      config: { agentName: "Maya", companyName: "", description: "e-commerce support" },
    });
    const parsed = parseVibeGeminiJson(raw);
    expect(parsed?.reply).toContain("company");
    expect(parsed?.phase).toBe("core");
    expect(parsed?.ready).toBe(false);
  });

  it("strips markdown fences", () => {
    const raw = '```json\n{"reply":"Hi","phase":"core","ready":false,"config":{}}\n```';
    expect(parseVibeGeminiJson(raw)?.reply).toBe("Hi");
  });

  it("extracts JSON from leading prose", () => {
    const raw = 'Here you go:\n{"reply":"Done","phase":"core","ready":false,"config":null}';
    expect(parseVibeGeminiJson(raw)?.reply).toBe("Done");
  });

  it("returns null for invalid payloads", () => {
    expect(parseVibeGeminiJson("not json at all")).toBeNull();
    expect(parseVibeGeminiJson('{"phase":"core","ready":false,"config":{}}')).toBeNull();
  });
});

describe("parseVoicePick", () => {
  it("parses Select messages with voiceId", () => {
    expect(parseVoicePick("I'll go with Varun (voiceId: abc-123)")).toEqual({
      voiceName: "Varun",
      voiceId: "abc-123",
    });
  });

  it("parses Select messages without voiceId", () => {
    expect(parseVoicePick("I'll go with Gayathri")).toEqual({ voiceName: "Gayathri" });
  });

  it("ignores unrelated messages", () => {
    expect(parseVoicePick("Walk me through the call")).toBeNull();
  });
});

describe("phone + call-flow helpers", () => {
  it("detects assign / skip", () => {
    expect(looksLikePhoneAssign("Assign +9198 (number id 12) as the inbound number")).toBe(true);
    expect(looksLikePhoneSkip("Skip the phone number for now")).toBe(true);
  });

  it("detects call-flow questions", () => {
    expect(replyAsksCallFlow("Great. Walk me through how Maya should handle the call.")).toBe(true);
    expect(replyAsksCallFlow("Okay, Varun will use this voice.")).toBe(false);
  });
});

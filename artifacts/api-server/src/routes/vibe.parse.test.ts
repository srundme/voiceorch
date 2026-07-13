import { describe, it, expect } from "vitest";
import { parseVibeGeminiJson } from "./vibe-gemini-parse.js";

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

import { describe, expect, it } from "vitest";
import { buildCreatedAgentCopy, normalizeAgentLanguage } from "./assistant-copy.js";

describe("normalizeAgentLanguage", () => {
  it("maps spoken language to BCP-47", () => {
    expect(normalizeAgentLanguage("Tamil tanglish")).toBe("ta-IN");
    expect(normalizeAgentLanguage("hindi")).toBe("hi-IN");
    expect(normalizeAgentLanguage("English")).toBe("en-IN");
  });
});

describe("buildCreatedAgentCopy", () => {
  it("writes a Tamil greeting for ta-IN agents", () => {
    const copy = buildCreatedAgentCopy({
      agentName: "Priya",
      useCase: "loan collection",
      companyName: "SnapServe",
      language: "ta-IN",
    });
    expect(copy.greetingMessage).toContain("Priya");
    expect(copy.greetingMessage).toContain("வணக்கம்");
    expect(copy.systemPrompt).toContain("Tanglish");
  });
});

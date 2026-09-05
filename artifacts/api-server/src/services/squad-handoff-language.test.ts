import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
const { buildHandoffPromptBlock, resolveSquadHandoffLanguage } = await import("./squad-handoff.js");

describe("resolveSquadHandoffLanguage", () => {
  it("maps agent-1 Tamil onto the teammate instead of the teammate's English", () => {
    expect(resolveSquadHandoffLanguage("ta-IN", "en-IN")).toEqual({
      bcp47: "ta-IN",
      label: "Tamil",
      fromCaller: true,
    });
    expect(resolveSquadHandoffLanguage("tamil", "en-IN").bcp47).toBe("ta-IN");
    expect(resolveSquadHandoffLanguage("ta", "hi-IN").fromCaller).toBe(true);
  });

  it("keeps the teammate language when agent 1 never established a preference", () => {
    expect(resolveSquadHandoffLanguage(null, "en-IN")).toEqual({
      bcp47: "en-IN",
      label: "English",
      fromCaller: false,
    });
    expect(resolveSquadHandoffLanguage("", "hi-IN").fromCaller).toBe(false);
  });
});

describe("buildHandoffPromptBlock", () => {
  it("tells agent 2 to keep speaking the caller's language", () => {
    const block = buildHandoffPromptBlock({
      fromMemberId: 1,
      toMemberId: 2,
      fromAgentId: 10,
      toAgentId: 20,
      reason: "booking",
      goal: "book",
      transcriptSummary: "Caller asked for Tamil then a demo.",
      language: "ta-IN",
    });
    expect(block).toContain("Tamil");
    expect(block).toContain("MUST continue this live call in Tamil");
    expect(block).toContain("overrides any other language rule");
    expect(block).not.toMatch(/Do not restart in English/);
    expect(block).not.toMatch(/Caller language preference: ta-IN\s*$/m);
  });

  it("orders agent 2 to stay in English when that is what agent 1 was speaking", () => {
    const block = buildHandoffPromptBlock({
      fromMemberId: 1,
      toMemberId: 2,
      fromAgentId: 10,
      toAgentId: 20,
      reason: "booking",
      goal: "book",
      transcriptSummary: "Caller confirmed English and asked for a cardiologist.",
      language: "en-IN",
    });
    expect(block).toContain("English");
    expect(block).toContain("MUST continue this live call in English");
    expect(block).not.toContain("Do not restart in English");
  });

  it("omits a language order when none was captured", () => {
    const block = buildHandoffPromptBlock({
      fromMemberId: 1,
      toMemberId: 2,
      fromAgentId: 10,
      toAgentId: 20,
      reason: "booking",
      goal: "book",
      transcriptSummary: "hello",
    });
    expect(block).not.toContain("MUST continue this live call");
  });
});

describe("squad live handoff takeover wiring", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const handoffSrc = readFileSync(resolve(here, "squad-handoff.ts"), "utf8");
  const sessionSrc = readFileSync(resolve(here, "../orchestration/session.ts"), "utf8");
  const teamworkSrc = readFileSync(resolve(here, "squad-teamwork.ts"), "utf8");

  it("builds the teammate as assistant-first with a takeover flag", () => {
    expect(handoffSrc).toContain('firstSpeaker: "assistant"');
    expect(handoffSrc).not.toMatch(/firstSpeaker:\s*"user"/);
    expect(handoffSrc).toContain("isSquadHandoffTakeover: true");
    expect(handoffSrc).toContain("handoffSeedTurns: opts.previousPipeline.getHistory()");
  });

  it("greets on the receiving pipeline after the pointer swap", () => {
    expect(sessionSrc).toContain("result.pipeline.greet()");
    expect(sessionSrc).toContain("Squad handoff: receiving agent greet failed");
  });

  it("does not tell the departing agent the system will announce for them", () => {
    expect(teamworkSrc).not.toContain("the system speaks a handoff announcement for you");
    expect(teamworkSrc).toContain("briefly tell them you are connecting a teammate");
  });
});

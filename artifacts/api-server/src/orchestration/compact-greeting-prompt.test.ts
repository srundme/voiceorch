import { describe, it, expect } from "vitest";
import {
  buildCompactGreetingPrompt,
  isReturningCallerMemoryBlock,
} from "./compact-greeting-prompt.js";

const RETURNING_MEMORY = `=== CALLER MEMORY ===
Name: unknown  |  Calls: 9
⚠️ IMPORTANT — THIS IS A RETURNING CALLER YOU ALREADY KNOW (call #10). Do NOT introduce yourself.
=====================================`;

const SCRIPT = `IDENTITY
Name: Merlin
Company: Yemmar Finserv

CALL FLOW
1. GREETING
Speak first, once: "வணக்கம், நான் மெர்லின் பேசுறேன் Yemmar Finserv-ல இருந்து."`;

describe("isReturningCallerMemoryBlock", () => {
  it("matches nameless returning callers by call count or returning-caller marker", () => {
    expect(isReturningCallerMemoryBlock(RETURNING_MEMORY)).toBe(true);
    expect(isReturningCallerMemoryBlock("=== CALLER MEMORY ===\nName: unknown\n")).toBe(false);
  });
});

describe("buildCompactGreetingPrompt", () => {
  it("does not tell the greeting LLM to replay FLOW GREETING for a nameless returning caller", () => {
    const out = buildCompactGreetingPrompt(`${RETURNING_MEMORY}\n\n${SCRIPT}`, "ta-IN");
    expect(out).toContain("OPENING — RETURNING CALLER");
    expect(out).toContain("Skip the first-time welcome");
    expect(out).not.toContain("Speak the GREETING / opening from CALL FLOW");
  });

  it("still asks first-time calls to speak the scripted GREETING / FLOW opener", () => {
    const out = buildCompactGreetingPrompt(SCRIPT, "ta-IN");
    expect(out).not.toContain("OPENING — RETURNING CALLER");
    expect(out).toMatch(/GREETING \/ opening|opening\/greeting instructions/);
  });

  it("turns an outbound first greeting into a short identity-first permission opener", () => {
    const out = buildCompactGreetingPrompt(SCRIPT, "en-IN", false, { callDirection: "outbound" });
    expect(out).toContain("This is a phone call, not a demo");
    expect(out).toContain("your name/company exactly as scripted");
    expect(out).toContain("ask permission to continue");
    expect(out).toContain("18 words or fewer");
    expect(out).toContain("Do not deliver the full pitch yet");
  });

  it("does not override returning-call pickup with the first-contact script", () => {
    const out = buildCompactGreetingPrompt(`${RETURNING_MEMORY}\n\n${SCRIPT}`, "en-IN", false, { callDirection: "outbound" });
    expect(out).toContain("OPENING — RETURNING CALLER");
    expect(out).not.toContain("This is a phone call, not a demo");
  });

  it("clips a promptCore FLOW heading the same way as CALL FLOW on huge prompts", () => {
    const flowScript = `IDENTITY
Name: Merlin

FLOW
1. GREETING
Speak first, once: "வணக்கம்"`;
    const huge = `${RETURNING_MEMORY}\n\n${flowScript}\n${"K".repeat(13_000)}`;
    const out = buildCompactGreetingPrompt(huge, "ta-IN");
    expect(out).toContain("OPENING — RETURNING CALLER");
    expect(out).toContain("Speak first, once");
    expect(out).not.toContain("Speak the GREETING / opening from CALL FLOW");
  });
});

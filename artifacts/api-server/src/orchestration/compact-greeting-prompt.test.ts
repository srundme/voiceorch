import { describe, it, expect } from "vitest";
import {
  buildCompactGreetingPrompt,
  isReturningCallerMemoryBlock,
  stripHallucinatedCompanyVerifyGreeting,
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
    const named = buildCompactGreetingPrompt(`${RETURNING_MEMORY}\n\n${SCRIPT}`, "en-IN", false, { agentName: "Malar" });
    expect(named).toContain("Never greet or address the caller as Malar");
    expect(named).toContain("never add Madam");
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
    expect(out).toContain("NEVER invent verifying company/business details");
  });

  it("free_text outbound opener bans inventing a company/business reason", () => {
    const out = buildCompactGreetingPrompt(
      "# Role\nYou are Vijay calling voters.\nStep 1: warm Tamil opening.",
      "ta-IN",
      false,
      { callDirection: "outbound", scriptMode: "free_text" },
    );
    expect(out).toContain("Do NOT invent a company, business, recruitment, verification");
    expect(out).toContain("NEVER invent verifying company/business details");
    expect(out).not.toContain("your name/company exactly as scripted");
  });

  it("strips hallucinated company-verify clauses from greeting (call 28926)", () => {
    const raw =
      "வணக்கம், நான் விஜய்யாக பேசுகிறேன். உங்கள் நிறுவனத்தின் விவரங்களை சரிபார்க்க அழைத்தேன். நான் தொடரலாமா?";
    expect(
      stripHallucinatedCompanyVerifyGreeting(raw, "# Role\nYou are Vijay. Warm Tamil opening."),
    ).toBe("வணக்கம், நான் விஜய்யாக பேசுகிறேன். நான் தொடரலாமா?");
    expect(
      stripHallucinatedCompanyVerifyGreeting(raw, "Please verify company details with the caller."),
    ).toBe(raw);
  });
});

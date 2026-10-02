import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, agentsTable: {}, phoneNumbersTable: {}, simulationTestCasesTable: {} }));
vi.mock("@workspace/db/call-engine-defaults", () => ({ callEngineInsertDefaults: () => ({}) }));

import { buildCallerAgentValues, buildCallerPersonaPrompt } from "./caller-agent.js";

const testCase = {
  personaPrompt: "You are Kavitha, 38, from Velachery, registering your son for the science fair.",
  goal: "Register Arjun for Galaxy Marvel Science Fair 2026",
  language: "en-IN",
  callerRole: "Parent registering a 9-year-old for Galaxy Marvel Science Fair 2026",
  callerFacts: [
    { label: "Your name", value: "Kavitha Raman" },
    { label: "Child age", value: "9" },
    { label: "Mobile (say it like this)", value: "nine eight four four five, one two three one two" },
  ],
};

describe("buildCallerPersonaPrompt", () => {
  it("frames the caller as the business's counterpart and lists the facts to give", () => {
    const p = buildCallerPersonaPrompt(testCase);
    expect(p).toContain("Parent registering a 9-year-old for Galaxy Marvel Science Fair 2026.");
    expect(p).toContain("## Your details");
    expect(p).toContain("- Your name: Kavitha Raman");
    expect(p).toContain("- Mobile (say it like this): nine eight four four five, one two three one two");
    expect(p).toContain("Use only the details listed above");
    expect(p).toContain("Never say or hint that you are an AI");
    expect(p).not.toMatch(/\btest case\b|\bbrief\b/i);
  });

  it("still works for older cases without caller facts", () => {
    const p = buildCallerPersonaPrompt({ personaPrompt: testCase.personaPrompt, goal: testCase.goal, language: null });
    expect(p).not.toContain("## Your details");
    expect(p).toContain("invent realistic Indian details");
  });

  it("is what the hidden caller agent gets as its system prompt", () => {
    const values = buildCallerAgentValues({
      target: { id: 1, userId: "u", name: "Vijay", language: "en-IN", ttsVoice: "priya", telephonyProvider: "vobiz", firstSpeaker: "assistant" },
      testCase: { ...testCase, id: 3, name: "Happy path", callerGender: "female", maxDurationSeconds: 300 } as never,
      outboundPhoneNumberId: null,
    });
    expect(values.systemPrompt).toContain("- Child age: 9");
    expect(values.isTestPersona).toBe(true);
  });
});

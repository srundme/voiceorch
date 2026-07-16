import { describe, it, expect } from "vitest";
import {
  buildPatternSystemPrompt,
  CARTESIA_SPEECH_BLOCK,
  HUMAN_SPEECH_RULES_BLOCK,
} from "./vibe-system-prompt-pattern.js";

describe("buildPatternSystemPrompt", () => {
  const base = {
    agentName: "Varsha",
    companyName: "Acme Care",
    description: "Welcome new policy holders and explain app benefits",
    language: "ta-IN",
    langDisplay: "Tamil (India)",
    languageMode: "single" as const,
    multilingualLanguages: [] as string[],
    direction: "outbound" as const,
    callFlowNotes: "Introduce wellness coins.\n\nAsk if they have the app.\n\nWalk through one benefit at a time.",
    mandatoryQuestions: "1. Do you have the app?\n2. Any questions on coins?",
    agentRules: "Never quote exact premium without specialist.",
    callbackGreeting: "Last time we spoke about the app — shall we continue?",
    dispositionLogic: "Interested if they install app; Not interested if they refuse callbacks.",
    genderDetectionEnabled: true,
    maleSalutation: "Sir",
    femaleSalutation: "Ma'am",
    callTransferEnabled: true,
    transferPhoneNumber: "+919999999999",
    transferName: "Senior desk",
    voicemailEnabled: false,
    voicemailMessage: "",
    schedulingEnabled: false,
    compliance: { dpdp: true, trai: false, irdai: false },
    dispositions: [{ category: "Interested", outcomes: ["Will install app"] }],
  };

  it("uses the proved section pattern with Cartesia + human speech rules", () => {
    const prompt = buildPatternSystemPrompt(base);
    expect(prompt).toContain("**IDENTITY**");
    expect(prompt).toContain("You are Varsha");
    expect(prompt).toContain("Acme Care");
    expect(prompt).toContain("**LANGUAGE STYLE**");
    expect(prompt).toContain("English words");
    expect(prompt).toContain("**CALL FLOW**");
    expect(prompt).toContain("Introduce wellness coins");
    expect(prompt).toContain("**Mandatory questions**");
    expect(prompt).toContain("{{caller_salutation}}");
    expect(prompt).toContain(CARTESIA_SPEECH_BLOCK.slice(0, 40));
    expect(prompt).toContain('<emotion value="curious"/>');
    expect(prompt).toMatch(/self-closing/);
    expect(prompt).toContain("enthusiastic");
    expect(prompt).toContain(HUMAN_SPEECH_RULES_BLOCK.slice(0, 40));
    expect(prompt).toContain("RULE 7");
    expect(prompt).toContain("**CALL GOAL**");
    expect(prompt).toContain("**RESPONSE HANDLING**");
    expect(prompt).toContain("Senior desk");
  });

  it("does not include unrelated brand content from the example prompt", () => {
    const prompt = buildPatternSystemPrompt(base);
    expect(prompt).not.toContain("Galaxy Health Insurance");
    expect(prompt).not.toContain("Gala Fit");
    expect(prompt).not.toContain("1800 2023 0007");
  });

  it("mentions language switch for multilingual agents", () => {
    const prompt = buildPatternSystemPrompt({
      ...base,
      languageMode: "multi",
      multilingualLanguages: ["ta-IN", "hi-IN"],
      langDisplay: "Multi-language",
    });
    expect(prompt).toMatch(/SWITCHES LANGUAGE/i);
  });
});

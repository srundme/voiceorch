import { describe, expect, it } from "vitest";
import {
  applyAffirmationPhaseAdvance,
  looksLikeAffirmation,
  type GeminiVibeResponse,
} from "./vibe-gemini-parse.js";

describe("looksLikeAffirmation", () => {
  it("matches short continue nudges", () => {
    for (const t of ["okay", "ok", "yes", "sure", "go next", "use it as-is", "then", "looks good"]) {
      expect(looksLikeAffirmation(t), t).toBe(true);
    }
  });

  it("rejects real edits", () => {
    expect(looksLikeAffirmation("change the opening to be warmer")).toBe(false);
    expect(looksLikeAffirmation("make discovery ask for phone number")).toBe(false);
  });
});

describe("applyAffirmationPhaseAdvance", () => {
  it("advances call_flow → knowledge_base on okay and fills defaults", () => {
    const parsed: GeminiVibeResponse = {
      reply: "Okay, Riya will do a quick re-introduction for returning callers.",
      phase: "call_flow",
      ready: false,
      config: {
        agentName: "Riya",
        companyName: "Smile Care",
        callFlowNotes: "Opening\n- Hello",
        mandatoryQuestions: "",
        agentRules: "",
        callbackGreeting: "",
      },
    };
    applyAffirmationPhaseAdvance(parsed, "okay");
    expect(parsed.phase).toBe("knowledge_base");
    expect(String(parsed.config?.["mandatoryQuestions"])).toMatch(/Caller full name/);
    expect(String(parsed.config?.["callbackGreeting"])).toMatch(/Quick re-intro/);
    expect(parsed.reply).toMatch(/knowledge base/i);
  });

  it("advances knowledge_base → features_gender on yes or skip", () => {
    const parsed: GeminiVibeResponse = {
      reply: "Noted.",
      phase: "knowledge_base",
      ready: false,
      config: { agentName: "Riya", companyName: "Smile Care" },
    };
    applyAffirmationPhaseAdvance(parsed, "yes");
    expect(parsed.phase).toBe("features_gender");
    expect(parsed.reply).toMatch(/Sir or Ma'am/);

    const skipped: GeminiVibeResponse = {
      reply: "Noted.",
      phase: "knowledge_base",
      ready: false,
      config: { agentName: "Riya", companyName: "Smile Care" },
    };
    applyAffirmationPhaseAdvance(skipped, "skip");
    expect(skipped.phase).toBe("features_gender");
  });
});

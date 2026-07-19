import { describe, expect, it } from "vitest";
import {
  applyAffirmationPhaseAdvance,
  looksLikeAffirmation,
  looksLikeContinueIntent,
  looksLikeSoftSkip,
  type GeminiVibeResponse,
} from "./vibe-gemini-parse.js";

describe("looksLikeAffirmation", () => {
  it("matches short continue nudges", () => {
    for (const t of ["okay", "ok", "yes", "sure", "go next", "use it as-is", "then", "looks good", "okay then", "ok then"]) {
      expect(looksLikeAffirmation(t), t).toBe(true);
    }
  });

  it("rejects real edits", () => {
    expect(looksLikeAffirmation("change the opening to be warmer")).toBe(false);
    expect(looksLikeAffirmation("make discovery ask for phone number")).toBe(false);
  });
});

describe("looksLikeContinueIntent", () => {
  it("matches KB continue lines from the stuck-loop screenshot", () => {
    expect(looksLikeContinueIntent("I've added my knowledge base documents. Continue.")).toBe(true);
    expect(looksLikeContinueIntent("okay then")).toBe(true);
  });
});

describe("looksLikeSoftSkip", () => {
  it("treats no/none as soft skip for compliance", () => {
    expect(looksLikeSoftSkip("no")).toBe(true);
    expect(looksLikeSoftSkip("none")).toBe(true);
    expect(looksLikeSoftSkip("skip")).toBe(true);
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

  it("breaks compliance re-confirm loop on okay then / continue", () => {
    const parsed: GeminiVibeResponse = {
      reply: "Okay, no compliance standards will be applied to Riya.",
      phase: "features_compliance",
      ready: false,
      config: { agentName: "Riya", companyName: "Smile Care", compliance: { dpdp: false, trai: false, irdai: false } },
    };
    applyAffirmationPhaseAdvance(parsed, "okay then");
    expect(parsed.phase).toBe("dispositions");
    expect(parsed.reply).toMatch(/HOT|Interested/i);
    expect(parsed.reply).not.toMatch(/^Okay, no compliance standards will be applied/);
  });

  it("advances when model re-states compliance confirm and user says Continue after KB note", () => {
    const parsed: GeminiVibeResponse = {
      reply: "Okay, no compliance standards will be applied to Riya.",
      phase: "knowledge_base", // model drifted phase but kept repeating confirm
      ready: false,
      config: { agentName: "Riya", companyName: "Smile Care" },
    };
    applyAffirmationPhaseAdvance(parsed, "I've added my knowledge base documents. Continue.");
    expect(parsed.phase).toBe("dispositions");
    expect(parsed.reply).toMatch(/HOT|Interested/i);
  });

  it("treats bare no on compliance as none + advance", () => {
    const parsed: GeminiVibeResponse = {
      reply: "Okay, no compliance standards will be applied to Riya.",
      phase: "features_compliance",
      ready: false,
      config: { agentName: "Riya", companyName: "Smile Care" },
    };
    applyAffirmationPhaseAdvance(parsed, "no");
    expect(parsed.phase).toBe("dispositions");
    expect(parsed.config?.["compliance"]).toEqual({ dpdp: false, trai: false, irdai: false });
  });
});

import { describe, expect, it } from "vitest";
import {
  evaluateTurnAcceptance,
  inferExpectedSlot,
  matchGlobalIntent,
  resolveTurnAcceptanceMode,
  shouldEnforceTurnDecision,
  trustedTopicChangeScore,
  type TurnAcceptanceInput,
} from "./turn-acceptance.js";

function base(over: Partial<TurnAcceptanceInput> = {}): TurnAcceptanceInput {
  return {
    transcript: "",
    lastAgentText: "",
    expectingShortAnswer: false,
    rawNearRms: 400,
    sileroConfidence: 0.2,
    sileroSustained: false,
    speechDurationMs: 200,
    bargeStrength: "weak",
    selfEcho: false,
    backgroundSpeechHistory: 0,
    clarificationsForQuestion: 0,
    msSinceLastClarification: Number.POSITIVE_INFINITY,
    ...over,
  };
}

const strongAcoustic = {
  rawNearRms: 2500,
  sileroSustained: true,
  sileroConfidence: 0.85,
  speechDurationMs: 1100,
  bargeStrength: "hard" as const,
};

describe("resolveTurnAcceptanceMode", () => {
  it("defaults to shadow", () => {
    expect(resolveTurnAcceptanceMode({})).toBe("shadow");
  });
});

describe("evaluateTurnAcceptance — corrected policy", () => {
  it("never ACCEPTs strong TV/reel under night-shift question (CLARIFY)", () => {
    const r = evaluateTurnAcceptance(
      base({
        lastAgentText: "Are you comfortable with the night shift?",
        transcript: "They don't move in the right direction.",
        ...strongAcoustic,
      }),
    );
    expect(r.decision).toBe("clarify");
    expect(r.decision).not.toBe("accept");
    expect(r.utteranceCoherence).toBeGreaterThanOrEqual(0.75);
    expect(r.trustedTopicChange).toBe(false);
    expect(r.semanticScore).toBeLessThan(0.7);
  });

  it("IGNOREs weak reel mismatch under night-shift", () => {
    const r = evaluateTurnAcceptance(
      base({
        lastAgentText: "Are you comfortable with the night shift?",
        transcript: "They don't move in the right direction.",
        rawNearRms: 300,
        sileroSustained: false,
        bargeStrength: "weak",
        speechDurationMs: 250,
      }),
    );
    expect(r.decision).toBe("ignore");
  });

  it("ACCEPTs trusted topic change: Actually, what is the salary?", () => {
    const r = evaluateTurnAcceptance(
      base({
        lastAgentText: "Are you comfortable with the night shift?",
        transcript: "Actually, what is the salary?",
        ...strongAcoustic,
      }),
    );
    expect(r.decision).toBe("accept");
    expect(["trusted_topic_change", "global_intent"]).toContain(r.reason);
  });

  it("ACCEPTs explicit topic-change cue without info-question patterns alone", () => {
    const r = evaluateTurnAcceptance(
      base({
        lastAgentText: "Are you comfortable with the night shift?",
        transcript: "Actually, I have another question about the office.",
        ...strongAcoustic,
      }),
    );
    expect(r.decision).toBe("accept");
    expect(r.trustedTopicChange || r.globalIntentMatch).toBe(true);
  });

  it("does not person_name-match 'supports number seven'", () => {
    const r = evaluateTurnAcceptance(
      base({
        lastAgentText: "May I know your name?",
        transcript: "supports number seven",
        ...strongAcoustic,
      }),
    );
    expect(r.expectedSlot).toBe("person_name");
    expect(r.expectedSlotMatch).toBe(false);
    expect(r.decision).not.toBe("accept");
    expect(["clarify", "ignore"]).toContain(r.decision);
  });

  it("open question + unrelated strong fluent → ACCEPT fail-open", () => {
    const r = evaluateTurnAcceptance(
      base({
        lastAgentText: "Tell me a bit about yourself and what you're looking for.",
        transcript: "They don't move in the right direction.",
        ...strongAcoustic,
      }),
    );
    expect(r.expectedSlot).toBe("open");
    expect(r.decision).toBe("accept");
    expect(r.reason).toMatch(/open_fail_open/);
  });

  it("repeated mismatch after one clarification does not clarify again", () => {
    const r = evaluateTurnAcceptance(
      base({
        lastAgentText: "Are you comfortable with the night shift?",
        transcript: "Supports number 7.",
        ...strongAcoustic,
        clarificationsForQuestion: 1,
        msSinceLastClarification: 5_000,
        backgroundSpeechHistory: 2,
      }),
    );
    expect(r.decision).not.toBe("clarify");
    expect(["accept", "ignore"]).toContain(r.decision);
  });

  it("global intent under weak audio only if unambiguous", () => {
    expect(
      evaluateTurnAcceptance(
        base({
          lastAgentText: "Shall we continue?",
          transcript: "Not interested",
          rawNearRms: 400,
          sileroSustained: false,
          speechDurationMs: 200,
          bargeStrength: "weak",
        }),
      ).decision,
    ).toBe("accept");
    // Soft/ambiguous should not fire under weak acoustics via INFO_QUESTION alone
    expect(matchGlobalIntent("what about that", "weak")).toBe(false);
    expect(matchGlobalIntent("Not interested", "weak")).toBe(true);
  });

  it("ACCEPTs duration answer with zero lexical overlap", () => {
    const r = evaluateTurnAcceptance(
      base({
        lastAgentText: "Are you currently working?",
        transcript: "I left last month.",
        ...strongAcoustic,
      }),
    );
    expect(r.decision).toBe("accept");
    expect(r.expectedSlot).toBe("duration");
  });

  it("ACCEPTs short yes under closed question", () => {
    expect(
      evaluateTurnAcceptance(
        base({
          lastAgentText: "Are you comfortable with the night shift?",
          transcript: "Yes",
          expectingShortAnswer: true,
          ...strongAcoustic,
        }),
      ).decision,
    ).toBe("accept");
  });

  it("coherence alone never ACCEPTs", () => {
    expect(
      trustedTopicChangeScore("They don't move in the right direction.", "strong"),
    ).toBe(0);
  });

  it("enforce only blocks structured ignore/clarify", () => {
    expect(shouldEnforceTurnDecision("shadow", "ignore", "yes_no")).toBe(false);
    expect(shouldEnforceTurnDecision("enforce", "ignore", "yes_no")).toBe(true);
    expect(shouldEnforceTurnDecision("enforce", "clarify", "yes_no")).toBe(true);
    expect(shouldEnforceTurnDecision("enforce", "ignore", "open")).toBe(false);
    expect(shouldEnforceTurnDecision("enforce", "accept", "yes_no")).toBe(false);
  });

  it("infers slots", () => {
    expect(inferExpectedSlot("Are you comfortable with the night shift?")).toBe("yes_no");
    expect(inferExpectedSlot("Are you currently working?")).toBe("duration");
    expect(inferExpectedSlot("May I know your name?")).toBe("person_name");
  });
});

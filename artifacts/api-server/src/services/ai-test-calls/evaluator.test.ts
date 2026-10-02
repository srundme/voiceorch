import { describe, it, expect, vi, beforeEach } from "vitest";

const chainMock = vi.fn();
vi.mock("../disposition-llm.js", () => ({
  getDispositionLLMChain: (...a: unknown[]) => chainMock(...a),
}));
vi.mock("../../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  buildEvaluationSystemPrompt,
  evaluateTestCall,
  EvaluationUnavailableError,
  normalizeTestTranscript,
  parseEvaluation,
} from "./evaluator.js";
import { eventBrief } from "./test-fixtures.js";

const valid = {
  score: 82,
  verdict: "pass",
  criteria: [{ criterion: "Confirms number", pass: true, reason: "Read back", evidence: "9876543210, right?" }],
  issues: ["Slightly long greeting"],
  summary: "Good call.",
};

describe("parseEvaluation", () => {
  it("accepts a valid evaluation and clamps the score", () => {
    expect(parseEvaluation(valid)).toMatchObject({ score: 82, verdict: "pass" });
    expect(parseEvaluation({ ...valid, score: 140 })!.score).toBe(100);
    expect(parseEvaluation({ ...valid, score: "35" })!.score).toBe(35);
  });

  it("derives the verdict from criteria when missing", () => {
    const out = parseEvaluation({ ...valid, verdict: "", criteria: [{ ...valid.criteria[0], pass: false }] });
    expect(out!.verdict).toBe("fail");
  });

  it("rejects output without a numeric score or criteria (never invents a score)", () => {
    expect(parseEvaluation({ ...valid, score: undefined })).toBeNull();
    expect(parseEvaluation({ ...valid, score: "great" })).toBeNull();
    expect(parseEvaluation({ ...valid, criteria: [] })).toBeNull();
    expect(parseEvaluation(null)).toBeNull();
  });
});

describe("normalizeTestTranscript", () => {
  it("labels the target agent correctly from either leg", () => {
    const t = "Agent: Hello, Sunshine Clinic.\nCaller: Hi, I want an appointment.";
    expect(normalizeTestTranscript(t, "callee")).toBe("TARGET AGENT: Hello, Sunshine Clinic.\nCUSTOMER: Hi, I want an appointment.");
    expect(normalizeTestTranscript(t, "caller")).toBe("CUSTOMER: Hello, Sunshine Clinic.\nTARGET AGENT: Hi, I want an appointment.");
  });
});

describe("buildEvaluationSystemPrompt", () => {
  it("includes test criteria, owner criteria and latency", () => {
    const p = buildEvaluationSystemPrompt({
      goal: "Book a visit",
      criteria: ["Confirms the date"],
      agentSuccessCriteria: "Booking made",
      latency: { sttMs: 300, llmMs: 900, ttsMs: 400 },
    });
    expect(p).toContain("1. Confirms the date");
    expect(p).toContain("Booking made");
    expect(p).toContain("LLM 900");
    expect(p).not.toContain("WHAT THE AGENT WAS TOLD");
  });

  it("includes the brief as ground truth, targets and expected outcome", () => {
    const p = buildEvaluationSystemPrompt({
      goal: "Register child",
      criteria: ["Agent states the fee is ₹499 (F3)"],
      brief: eventBrief(),
      targets: [{ id: "F3", label: "Registration fee is ₹499 per child" }],
      expectedOutcome: "Registration captured",
    });
    expect(p).toContain("WHAT THE AGENT WAS TOLD");
    expect(p).toContain("F3: Registration fee is ₹499 per child");
    expect(p).toContain("X1: Parking at the venue");
    expect(p).toContain("Invented fact:");
    expect(p).toContain("THIS TEST TARGETS: F3 (Registration fee is ₹499 per child)");
    expect(p).toContain("EXPECTED OUTCOME: Registration captured");
    expect(p).toContain("refs");
  });
});

describe("parseEvaluation refs", () => {
  it("keeps valid brief ids cited by the judge", () => {
    const out = parseEvaluation({ ...valid, criteria: [{ ...valid.criteria[0], refs: ["f3", "R1", "bogus", 7] }] });
    expect(out!.criteria[0]!.refs).toEqual(["F3", "R1"]);
    expect(parseEvaluation(valid)!.criteria[0]!.refs).toEqual([]);
  });
});

describe("evaluateTestCall", () => {
  beforeEach(() => chainMock.mockReset());
  const input = { transcript: "TARGET AGENT: hi", goal: "g", criteria: ["c"] };

  it("returns the first usable evaluation", async () => {
    const bad = { extract: vi.fn().mockResolvedValue({ score: "?" }) };
    const ok = { extract: vi.fn().mockResolvedValue(valid) };
    chainMock.mockResolvedValue([{ provider: "sarvam", client: bad }, { provider: "openai", client: ok }]);
    const out = await evaluateTestCall(input);
    expect(out).toMatchObject({ score: 82, provider: "openai" });
  });

  it("sends the brief to the judge model", async () => {
    const ok = { extract: vi.fn().mockResolvedValue(valid) };
    chainMock.mockResolvedValue([{ provider: "sarvam", client: ok }]);
    await evaluateTestCall({ ...input, brief: eventBrief() });
    const [system, schema] = ok.extract.mock.calls[0]!;
    expect(system).toContain("F3: Registration fee is ₹499 per child");
    expect(JSON.stringify(schema)).toContain("refs");
  });

  it("throws EvaluationUnavailable when no model is configured", async () => {
    chainMock.mockResolvedValue([]);
    await expect(evaluateTestCall(input)).rejects.toBeInstanceOf(EvaluationUnavailableError);
  });

  it("throws EvaluationUnavailable when every provider fails", async () => {
    chainMock.mockResolvedValue([
      { provider: "sarvam", client: { extract: vi.fn().mockRejectedValue(new Error("500")) } },
      { provider: "openai", client: { extract: vi.fn().mockResolvedValue({ criteria: [] }) } },
    ]);
    await expect(evaluateTestCall(input)).rejects.toBeInstanceOf(EvaluationUnavailableError);
  });
});

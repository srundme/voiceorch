import { describe, it, expect } from "vitest";
import {
  briefCounts,
  targetChipLabel,
  testCaseFieldsFrom,
  emptyTestCase,
  estimateRunCostCents,
  formatDurationShort,
  formatRupees,
  isActiveRun,
  runStatusMeta,
  scoreTone,
  testCasePayload,
  testTranscriptLines,
  validateTestCase,
} from "./ai-test-calls";

describe("estimateRunCostCents", () => {
  it("bills both legs for the full time limit (upper bound)", () => {
    expect(estimateRunCostCents(300, { callerRateCentsPerMin: 500, targetRateCentsPerMin: 400 })).toBe(4500);
  });
  it("rounds each leg up and ignores negative rates", () => {
    expect(estimateRunCostCents(90, { callerRateCentsPerMin: 333, targetRateCentsPerMin: -1 })).toBe(500);
  });
});

describe("formatting", () => {
  it("formats rupees and durations", () => {
    expect(formatRupees(4500)).toBe("₹45.00");
    expect(formatRupees(null)).toBe("—");
    expect(formatDurationShort(65)).toBe("1m 05s");
    expect(formatDurationShort(42)).toBe("42s");
    expect(formatDurationShort(null)).toBe("—");
  });
  it("maps statuses and score tones", () => {
    expect(isActiveRun("in_call")).toBe(true);
    expect(isActiveRun("passed")).toBe(false);
    expect(runStatusMeta("evaluating").label).toBe("Grading");
    expect(runStatusMeta("weird").label).toBe("weird");
    expect(scoreTone(90)).toBe("good");
    expect(scoreTone(60)).toBe("warn");
    expect(scoreTone(10)).toBe("bad");
    expect(scoreTone(null)).toBe("muted");
  });
});

describe("testTranscriptLines", () => {
  const t = "Agent: Hello, clinic.\nCaller: I need an appointment\ntomorrow please.";
  it("labels the target agent from its own leg", () => {
    expect(testTranscriptLines(t, "target")).toEqual([
      { speaker: "agent", text: "Hello, clinic." },
      { speaker: "persona", text: "I need an appointment tomorrow please." },
    ]);
  });
  it("flips labels when only the AI caller's leg has a transcript", () => {
    expect(testTranscriptLines(t, "caller").map((l) => l.speaker)).toEqual(["persona", "agent"]);
  });
  it("handles empty transcripts", () => {
    expect(testTranscriptLines(null, "target")).toEqual([]);
  });
});

describe("grounding helpers", () => {
  it("labels targets by kind", () => {
    expect(targetChipLabel({ id: "F3", kind: "fact", label: "Fee is ₹499" })).toBe("Fact: Fee is ₹499");
    expect(targetChipLabel({ id: "X1", kind: "out_of_scope", label: "Parking" })).toBe("Not in prompt: Parking");
  });

  it("summarises brief counts, skipping empty lists", () => {
    const brief = {
      business: "Galaxy Marvel Academy", offerings: [], counterpart: { who: "parent", situation: "" }, agentDirection: "inbound" as const,
      callObjective: "", languages: [], flowSteps: [{ id: "S1", text: "Greet" }], requiredInfo: [],
      facts: [{ id: "F1", text: "a", sourceQuote: "" }, { id: "F2", text: "b", sourceQuote: "" }], rules: [],
      objectionsHandled: [], outOfScope: [], toolsUsage: [],
    };
    expect(briefCounts(brief)).toEqual([{ label: "flow steps", count: 1 }, { label: "facts", count: 2 }]);
  });

  it("fills grounding fields for older saved cases and trims caller facts on save", () => {
    const fields = testCaseFieldsFrom({ name: "Old", personaPrompt: "A long enough persona", goal: "Book", successCriteria: [] });
    expect(fields.targets).toEqual([]);
    expect(fields.callerFacts).toEqual([]);
    expect(fields.successCriteria).toEqual([""]);
    const payload = testCasePayload({ ...fields, callerFacts: [{ label: " Name ", value: " Kavitha " }, { label: "", value: "x" }], expectedOutcome: "  " });
    expect(payload.callerFacts).toEqual([{ label: "Name", value: "Kavitha" }]);
    expect(payload.expectedOutcome).toBeNull();
  });
});

describe("validateTestCase", () => {
  const valid = { ...emptyTestCase(), name: "Booker", personaPrompt: "A busy parent calling", goal: "Book a visit", successCriteria: ["Confirms the slot", " "] };
  it("accepts a complete case and trims blank criteria in the payload", () => {
    expect(validateTestCase(valid)).toBeNull();
    expect(testCasePayload(valid).successCriteria).toEqual(["Confirms the slot"]);
  });
  it("flags missing fields", () => {
    expect(validateTestCase(emptyTestCase())).toMatch(/name/);
    expect(validateTestCase({ ...valid, personaPrompt: "short" })).toMatch(/persona/);
    expect(validateTestCase({ ...valid, successCriteria: [" "] })).toMatch(/criterion/);
  });
});

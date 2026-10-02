import { describe, it, expect, vi } from "vitest";

vi.mock("../../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  buildGroundingIndex,
  buildPersonaSystemPrompt,
  buildPersonaUserContent,
  generatePersonaDrafts,
  isGroundedCriterion,
  orderPersonas,
  parsePersonaDrafts,
  PersonaGenerationError,
  planScenarios,
  validatePersonas,
} from "./personas.js";
import { eventBrief } from "./test-fixtures.js";

const happy = {
  name: "Registers 9-year-old for the fair",
  scenario: "happy_path",
  targets: ["S1", "S2", "S3", "S4", "S5", "I1", "I2", "I3"],
  difficulty: "easy",
  language: "en-IN",
  callerGender: "female",
  callerRole: "Parent registering a 9-year-old for Galaxy Marvel Science Fair 2026",
  personaPrompt: "You are Kavitha, 38, from Velachery. You want to register your son Arjun for the science fair.",
  goal: "Register Arjun for the fair",
  callerFacts: [{ label: "Name", value: "Kavitha Raman" }, { label: "Mobile", value: "nine eight four four five, one two three one two" }],
  successCriteria: [
    "Agent collects parent name, child age and the 10-digit mobile (I1, I2, I3)",
    "Agent reads back the mobile number 98445 12312 correctly",
    "Agent states the registration fee is ₹499 (F3)",
  ],
  expectedOutcome: "Registration captured with parent name, child age 9 and mobile; fee ₹499 stated",
};

const overAge = {
  ...happy,
  name: "Over-age registration (age 15)",
  scenario: "rule_probe",
  targets: ["R1", "I2"],
  difficulty: "medium",
  successCriteria: ["Agent declines age 15 because eligibility is 6 to 14"],
  expectedOutcome: "Politely declined: age outside 6-14",
};

const generic = {
  ...happy,
  name: "Price-sensitive mother, Chennai",
  scenario: "price_sensitive",
  targets: ["F3"],
  successCriteria: [
    "Agent acknowledges the caller's concern about cost",
    "Agent offers available information on discounts",
  ],
};

const ghostTargets = { ...overAge, name: "Ghost", targets: ["F99", "Q1"] };

describe("planScenarios", () => {
  it("always starts with a happy path covering every flow step and required field", () => {
    const plan = planScenarios(eventBrief(), 1);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.scenario).toBe("happy_path");
    expect(plan[0]!.targets).toEqual(["S1", "S2", "S3", "S4", "S5", "I1", "I2", "I3"]);
  });

  it("chooses contextual scenarios from brief items and only layers generic behaviours as modifiers", () => {
    const plan = planScenarios(eventBrief(), 8);
    expect(plan.map((s) => s.scenario)).toEqual([
      "happy_path", "fact_check", "rule_probe", "field_correction", "objection", "out_of_scope_probe", "escalation", "fact_check",
    ]);
    expect(plan[1]!.targets).toEqual(["F1"]);
    expect(plan[2]!.focus).toContain("aged 6 to 14");
    expect(plan[5]!.targets).toEqual(["X1"]);
    expect(plan.every((s) => s.targets.length >= 1)).toBe(true);
    expect(plan.map((s) => s.scenario)).not.toContain("interrupts");
    expect(plan.filter((s) => s.modifier).map((s) => s.modifier)).toEqual(["interrupts", "code_mixed", "spoken_digits"]);
  });

  it("stops at the number of distinct brief items instead of padding", () => {
    const b = eventBrief();
    const tiny = { ...b, facts: [], rules: [], objectionsHandled: [], outOfScope: [], toolsUsage: [], requiredInfo: [b.requiredInfo[0]!] };
    expect(planScenarios(tiny, 10).map((s) => s.scenario)).toEqual(["happy_path", "field_correction"]);
  });
});

describe("prompts", () => {
  it("grounds the persona prompt in the brief and the plan", () => {
    const b = eventBrief();
    const sys = buildPersonaSystemPrompt(3);
    expect(sys).toContain("COUNTERPART");
    expect(sys).toContain("Never write criteria that would fit any business");
    const user = buildPersonaUserContent(b, planScenarios(b, 3), { agentName: "Vijay", agentLanguage: "en-IN" });
    expect(user).toContain("F3: Registration fee is ₹499 per child");
    expect(user).toContain("1. happy_path");
    expect(user).toContain("[targets: F1]");
  });
});

describe("grounding validation", () => {
  const brief = eventBrief();
  const index = buildGroundingIndex(brief);

  it("recognises criteria that cite brief ids, values or names", () => {
    expect(isGroundedCriterion("Agent states the registration fee (F3)", index)).toBe(true);
    expect(isGroundedCriterion("Agent quotes ₹499 per child", index)).toBe(true);
    expect(isGroundedCriterion("Agent mentions Chennai Trade Centre as the venue", index)).toBe(true);
    expect(isGroundedCriterion("Agent declines age 15 because eligibility is 6 to 14", index)).toBe(true);
  });

  it("flags generic criteria", () => {
    expect(isGroundedCriterion("Agent acknowledges the caller's concern about cost", index)).toBe(false);
    expect(isGroundedCriterion("Agent offers available information on discounts", index)).toBe(false);
    expect(isGroundedCriterion("Agent is polite and professional", index)).toBe(false);
  });

  it("drops generic or ungrounded personas and resolves targets", () => {
    const raw = parsePersonaDrafts({ personas: [generic, happy, ghostTargets, overAge] }, 10, "en-IN");
    const { accepted, rejected } = validatePersonas(raw, brief);
    expect(accepted.map((p) => p.name)).toEqual([happy.name, overAge.name]);
    expect(rejected.map((r) => r.persona.name)).toEqual([generic.name, "Ghost"]);
    expect(rejected[0]!.reason).toMatch(/generic/);
    expect(accepted[1]!.targets.map((t) => t.id)).toEqual(["R1", "I2"]);
    expect(accepted[0]!.callerFacts[1]!.value).toContain("nine eight");
    expect(accepted[0]!.expectedOutcome).toContain("₹499");
  });

  it("orders the happy path first and dedupes names", () => {
    const raw = parsePersonaDrafts({ personas: [overAge, happy, overAge] }, 10, "en-IN");
    const ordered = orderPersonas(validatePersonas(raw, brief).accepted, 10);
    expect(ordered.map((p) => p.scenario)).toEqual(["happy_path", "rule_probe"]);
  });
});

describe("generatePersonaDrafts", () => {
  it("returns grounded drafts without a repair call when all pass", async () => {
    const gen = vi.fn().mockResolvedValue({ data: { personas: [overAge, happy] }, provider: "gemini" });
    const out = await generatePersonaDrafts(eventBrief(), { count: 2, agentName: "Vijay", agentLanguage: "en-IN" }, gen);
    expect(gen).toHaveBeenCalledTimes(1);
    expect(gen.mock.calls[0]![0].temperature).toBeGreaterThan(0.3);
    expect(out.drafts.map((d) => d.scenario)).toEqual(["happy_path", "rule_probe"]);
  });

  it("repairs once, then returns only what passes (never pads with generic personas)", async () => {
    const gen = vi.fn()
      .mockResolvedValueOnce({ data: { personas: [generic, overAge, ghostTargets] }, provider: "gemini" })
      .mockResolvedValueOnce({ data: { personas: [happy, generic] }, provider: "gemini" });
    const out = await generatePersonaDrafts(eventBrief(), { count: 3, agentName: "Vijay", agentLanguage: "en-IN" }, gen);
    expect(gen).toHaveBeenCalledTimes(2);
    const repairPrompt = gen.mock.calls[1]![0].user as string;
    expect(repairPrompt).toContain('REJECTED "Price-sensitive mother, Chennai"');
    expect(repairPrompt).toContain("happy_path");
    expect(out.drafts.map((d) => d.name)).toEqual([happy.name, overAge.name]);
  });

  it("errors when nothing grounded survives", async () => {
    const gen = vi.fn().mockResolvedValue({ data: { personas: [generic] }, provider: "gemini" });
    await expect(generatePersonaDrafts(eventBrief(), { count: 1, agentName: "Vijay", agentLanguage: null }, gen))
      .rejects.toBeInstanceOf(PersonaGenerationError);
  });

  it("maps provider exhaustion to PersonaGenerationError", async () => {
    const err = Object.assign(new Error("no AI model configured"), { name: "TestLlmUnavailableError" });
    const gen = vi.fn().mockRejectedValue(err);
    await expect(generatePersonaDrafts(eventBrief(), { count: 2, agentName: "Vijay", agentLanguage: null }, gen))
      .rejects.toBeInstanceOf(PersonaGenerationError);
  });
});

import { describe, expect, it } from "vitest";
import { buildLeadContextBlock, buildCallContextBlock, normalizeCallVariables, resolvePromptVariables } from "./prompt-vars.js";

describe("buildLeadContextBlock", () => {
  it("includes a do-not-re-ask directive when name is known", () => {
    const block = buildLeadContextBlock({
      name: "gopi",
      phone: "918904887300",
      caller_name: "gopi",
      customer_name: "gopi",
      __sheet_pipeline_id: "abc",
      __sheet_row_index: "4",
    });
    expect(block).toContain("=== LEAD CONTEXT ===");
    expect(block).toContain("Name: gopi");
    expect(block).toContain("Phone: 918904887300");
    expect(block).toMatch(/already know this caller's name is gopi/i);
    expect(block).toMatch(/Do NOT ask for their name/i);
    expect(block).not.toContain("Caller Name");
    expect(block).not.toContain("Sheet Pipeline");
    expect(block).not.toContain("abc");
  });

  it("returns empty when only internal fields are present", () => {
    expect(buildLeadContextBlock({ __sheet_pipeline_id: "x" })).toBe("");
  });

  it("surfaces operator_update and request fields for campaign follow-ups", () => {
    const block = buildLeadContextBlock({
      name: "Priya",
      operator_update: "Refund of 1200 approved",
      order_status: "shipped",
    });
    expect(block).toContain("Operator Update: Refund of 1200 approved");
    expect(block).toContain("Order Status: shipped");
    expect(block).toMatch(/Do NOT ask for their name/i);
  });
});

describe("resolvePromptVariables", () => {
  it("substitutes name placeholders", () => {
    expect(resolvePromptVariables("Hi {{name}}", { name: "gopi" })).toBe("Hi gopi");
  });
});

describe("normalizeCallVariables", () => {
  it("numbers question arrays and stringifies scalars", () => {
    const out = normalizeCallVariables({
      patient_name: "Priya",
      age: 62,
      questions: ["How is your pain?", "Are you walking?"],
    });
    expect(out["patient_name"]).toBe("Priya");
    expect(out["age"]).toBe("62");
    expect(out["questions"]).toContain("1. How is your pain?");
    expect(out["questions"]).toContain("2. Are you walking?");
  });
});

describe("buildCallContextBlock", () => {
  it("lists patient fields and questions with a ask-in-order directive", () => {
    const block = buildCallContextBlock({
      patient_name: "Priya",
      category: "post-op knee",
      questions: "1. How is your pain?\n2. Are you walking?",
    });
    expect(block).toContain("=== THIS CALL ===");
    expect(block).toContain("Patient Name: Priya");
    expect(block).toContain("Questions to ask");
    expect(block).toContain("How is your pain?");
    expect(block).toMatch(/Ask every listed question/i);
  });
});

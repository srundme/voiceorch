import { describe, expect, it } from "vitest";
import { buildLeadContextBlock, resolvePromptVariables } from "./prompt-vars.js";

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
});

describe("resolvePromptVariables", () => {
  it("substitutes name placeholders", () => {
    expect(resolvePromptVariables("Hi {{name}}", { name: "gopi" })).toBe("Hi gopi");
  });
});

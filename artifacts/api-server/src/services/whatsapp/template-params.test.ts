import { describe, expect, it } from "vitest";
import {
  applyExplicitParams,
  parseTemplateParams,
  pickCallerName,
  resolveTemplateParams,
  type TemplateParamContext,
} from "./template-params.js";

const ctx: TemplateParamContext = {
  callerName: "Gopi",
  agentName: "Snapserve AI",
  summary: "Customer agreed to an on-site design consultation.",
  phone: "919999999999",
  outcome: "Interested",
  meetingTime: "",
  meetLink: "",
  fields: { city: "Mumbai", bhk: "Unknown", budget: 2500000, tags: ["a", "b"] },
};

describe("parseTemplateParams", () => {
  it("returns undefined when nothing is mapped", () => {
    expect(parseTemplateParams(undefined)).toBeUndefined();
    expect(parseTemplateParams([{ source: "auto" }, {}])).toBeUndefined();
  });

  it("keeps valid entries and downgrades unknown sources to auto", () => {
    expect(parseTemplateParams([
      { source: "caller_name", fallback: "there" },
      { source: "nope" },
      { source: "field", key: " city " },
      { source: "text", text: "Snapserve AI" },
    ])).toEqual([
      { source: "caller_name", fallback: "there" },
      { source: "auto" },
      { source: "field", key: "city" },
      { source: "text", text: "Snapserve AI" },
    ]);
  });
});

describe("resolveTemplateParams", () => {
  it("fills each slot from its source", () => {
    expect(resolveTemplateParams([
      { source: "caller_name" },
      { source: "agent_name" },
      { source: "summary" },
      { source: "field", key: "city" },
      { source: "field", key: "budget" },
      { source: "field", key: "tags" },
      { source: "auto" },
    ], ctx)).toEqual([
      "Gopi", "Snapserve AI", ctx.summary, "Mumbai", "2500000", "a, b", "",
    ]);
  });

  it("uses the fallback when the value is missing or 'Unknown'", () => {
    expect(resolveTemplateParams([
      { source: "caller_name", fallback: "there" },
      { source: "field", key: "bhk", fallback: "your home" },
      { source: "meet_link" },
    ], { ...ctx, callerName: "" })).toEqual(["there", "your home", ""]);
  });
});

describe("applyExplicitParams", () => {
  it("lets explicit values win and keeps inferred ones elsewhere", () => {
    expect(applyExplicitParams(["Gopi", "SnapServe", "—"], ["", "Snapserve AI", "Summary"]))
      .toEqual(["Gopi", "Snapserve AI", "Summary"]);
  });
});

describe("pickCallerName", () => {
  it("prefers the booking, then the lead, then an extracted name field", () => {
    expect(pickCallerName("Asha", "Lead", { name: "Field" })).toBe("Asha");
    expect(pickCallerName("", "Lead", { name: "Field" })).toBe("Lead");
    expect(pickCallerName("", null, { customer_name: "Field" })).toBe("Field");
    expect(pickCallerName(null, null, null)).toBe("");
  });
});

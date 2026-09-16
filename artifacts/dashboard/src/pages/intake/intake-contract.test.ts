import { describe, it, expect } from "vitest";
import {
  CITY_OPTIONS,
  cityOptionsWith,
  fieldToInputValue,
  formatDobForDisplay,
  intakeProgress,
  isFieldFilled,
} from "./intake-contract";

describe("cityOptionsWith", () => {
  it("leaves the list alone for a known city", () => {
    expect(cityOptionsWith("BENGALURU")).toEqual([...CITY_OPTIONS]);
  });

  it("folds in a city the agent captured that is not on the list", () => {
    const options = cityOptionsWith("shivamogga");
    expect(options[0]).toBe("SHIVAMOGGA");
    expect(options).toHaveLength(CITY_OPTIONS.length + 1);
  });

  it("ignores an empty value", () => {
    expect(cityOptionsWith(null)).toEqual([...CITY_OPTIONS]);
    expect(cityOptionsWith("  ")).toEqual([...CITY_OPTIONS]);
  });
});

describe("isFieldFilled", () => {
  it("counts zero as answered but blank text as not", () => {
    expect(isFieldFilled(0)).toBe(true);
    expect(isFieldFilled("")).toBe(false);
    expect(isFieldFilled("   ")).toBe(false);
    expect(isFieldFilled(null)).toBe(false);
    expect(isFieldFilled("BENGALURU")).toBe(true);
  });
});

describe("intakeProgress", () => {
  it("counts only the fields asked on the call", () => {
    expect(intakeProgress({})).toEqual({ filled: 0, total: 12 });
    expect(intakeProgress({ firstName: "Arbaz", totalCompanies: 0 })).toEqual({ filled: 2, total: 12 });
  });

  it("does not credit post-call English or DND", () => {
    expect(intakeProgress({ englishCommunication: "EXCELLENT", dnd: "ACTIVATE" })).toEqual({
      filled: 0,
      total: 12,
    });
  });
});

describe("formatDobForDisplay", () => {
  it("renders the stored ISO date as dd/mm/yyyy", () => {
    expect(formatDobForDisplay("2000-07-20")).toBe("20/07/2000");
    expect(formatDobForDisplay(null)).toBe("");
    expect(formatDobForDisplay("20/07/2000")).toBe("");
  });
});

describe("fieldToInputValue", () => {
  it("renders a zero number rather than an empty box", () => {
    expect(fieldToInputValue(0)).toBe("0");
    expect(fieldToInputValue(null)).toBe("");
    expect(fieldToInputValue("PUNE")).toBe("PUNE");
  });
});

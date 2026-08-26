import { describe, expect, it } from "vitest";
import {
  phonesMatch,
  cellMatchesPhone,
  extractPhoneCandidates,
  rowToPromptVars,
  resolveMatchColumnIndex,
  defaultColumnMapForUseCase,
  sheetRange,
  a1FromColIndex,
} from "./google-sheets-helpers.js";

describe("phonesMatch", () => {
  it("matches E.164 against bare 10-digit", () => {
    expect(phonesMatch("+919876543210", "9876543210")).toBe(true);
  });

  it("matches with spaces and dashes", () => {
    expect(phonesMatch("+91 98765-43210", "9876543210")).toBe(true);
  });

  it("matches leading-0 local format", () => {
    expect(phonesMatch("09876543210", "+919876543210")).toBe(true);
  });

  it("rejects different numbers", () => {
    expect(phonesMatch("+919876543210", "9876543211")).toBe(false);
  });
});

describe("extractPhoneCandidates / cellMatchesPhone", () => {
  it("extracts two numbers from one cell", () => {
    expect(extractPhoneCandidates("9876543210 / 9123456780")).toEqual([
      "9876543210",
      "9123456780",
    ]);
  });

  it("matches second number in a dual-phone cell", () => {
    expect(cellMatchesPhone("9876543210, 9123456780", "+919123456780")).toBe(true);
    expect(cellMatchesPhone("9876543210 / 9123456780", "9123456780")).toBe(true);
  });

  it("matches bare 10-digit against E.164 call phone", () => {
    expect(cellMatchesPhone("6383653279", "+916383653279")).toBe(true);
  });
});

describe("rowToPromptVars", () => {
  it("maps Name to name / customer_name / caller_name", () => {
    const vars = rowToPromptVars({
      Name: "Karthikeyan Srinivasan Ramasamy",
      "Phone Number": "9876543210 / 9123456780",
      City: "Chennai",
    });
    expect(vars.name).toBe("Karthikeyan Srinivasan Ramasamy");
    expect(vars.customer_name).toBe("Karthikeyan Srinivasan Ramasamy");
    expect(vars.caller_name).toBe("Karthikeyan Srinivasan Ramasamy");
    expect(vars.phone).toContain("9876543210");
    expect(vars.city).toBe("Chennai");
  });
});

describe("resolveMatchColumnIndex", () => {
  it("finds Phone Number when matchColumn is Phone", () => {
    expect(resolveMatchColumnIndex(["Name", "Phone Number", "City"], "Phone")).toBe(1);
  });

  it("falls back to mobile-like header", () => {
    expect(resolveMatchColumnIndex(["Name", "Mobile", "Notes"], "")).toBe(1);
  });
});

describe("defaultColumnMapForUseCase", () => {
  it("returns call_log headers", () => {
    const map = defaultColumnMapForUseCase("call_log");
    expect(map.phone).toBe("Phone");
    expect(map.callId).toBe("Call ID");
  });

  it("returns empty for custom", () => {
    expect(defaultColumnMapForUseCase("custom")).toEqual({});
  });
});

describe("sheetRange", () => {
  it("always quotes tab names", () => {
    expect(sheetRange("Call Log", "A1")).toBe("'Call Log'!A1");
    expect(sheetRange("Call Log", "A1:Z1")).toBe("'Call Log'!A1:Z1");
    expect(sheetRange("Leads", "A1")).toBe("'Leads'!A1");
  });
});

describe("a1FromColIndex", () => {
  it("maps 0-based indexes to A1 letters", () => {
    expect(a1FromColIndex(0)).toBe("A");
    expect(a1FromColIndex(9)).toBe("J");
    expect(a1FromColIndex(26)).toBe("AA");
  });
});

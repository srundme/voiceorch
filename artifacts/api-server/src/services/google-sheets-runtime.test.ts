import { describe, expect, it } from "vitest";
import { phonesMatch, defaultColumnMapForUseCase, sheetRange } from "./google-sheets-helpers.js";

describe("phonesMatch", () => {
  it("matches E.164 against bare 10-digit", () => {
    expect(phonesMatch("+919876543210", "9876543210")).toBe(true);
  });

  it("matches with spaces and dashes", () => {
    expect(phonesMatch("+91 98765-43210", "9876543210")).toBe(true);
  });

  it("rejects different numbers", () => {
    expect(phonesMatch("+919876543210", "9876543211")).toBe(false);
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
  it("quotes tab names with spaces", () => {
    expect(sheetRange("Call Log", "A1")).toBe("'Call Log'!A1");
  });
});

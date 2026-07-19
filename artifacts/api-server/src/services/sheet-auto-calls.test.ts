import { describe, expect, it } from "vitest";
import { extractPhoneCandidates, phonesMatch } from "./google-sheets-helpers.js";
import { parseSheetLeadRow } from "./sheet-auto-calls-helpers.js";

describe("parseSheetLeadRow", () => {
  const headers = ["Name", "Phone Number", "City", "Email"];

  it("parses phone without country code and long name", () => {
    const row = ["Karthikeyan Srinivasan Ramasamy", "6383653279", "Chennai", "k@example.com"];
    const parsed = parseSheetLeadRow(headers, row, {
      phone: "Phone Number",
      name: "Name",
      email: "Email",
    });
    expect(parsed.name).toBe("Karthikeyan Srinivasan Ramasamy");
    expect(parsed.phoneNormalized).toMatch(/^\+91/);
    expect(parsed.leadData.city).toBe("Chennai");
  });

  it("uses first number from dual-phone cell", () => {
    const row = ["A", "9876543210 / 9123456780", "X", ""];
    const parsed = parseSheetLeadRow(headers, row, { phone: "Phone Number" });
    expect(extractPhoneCandidates(row[1]!)).toHaveLength(2);
    expect(parsed.phoneNormalized).toBeTruthy();
    expect(phonesMatch(parsed.phoneNormalized!, "9876543210")).toBe(true);
  });

  it("returns null phoneNormalized for empty phone", () => {
    const parsed = parseSheetLeadRow(headers, ["A", "", "X", ""], { phone: "Phone Number" });
    expect(parsed.phoneNormalized).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { extractPhoneCandidates, phonesMatch } from "./google-sheets-helpers.js";
import {
  parseSheetLeadRow,
  fuzzyDetectColumnMap,
  isDoNotDialValue,
  isRetryStatus,
  friendlySheetStatus,
  formatSheetDisposition,
  resolveSheetStatusLabel,
  resolveDoNotDialHeader,
} from "./sheet-auto-calls-helpers.js";
import { issueRecordingShareToken, verifyRecordingShareToken } from "./recording-share.js";

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

describe("fuzzyDetectColumnMap", () => {
  it("maps Mobile / Caller Name / Email", () => {
    const map = fuzzyDetectColumnMap(["Caller Name", "Mobile", "Email", "City"]);
    expect(map.phone).toBe("Mobile");
    expect(map.name).toBe("Caller Name");
    expect(map.email).toBe("Email");
  });
});

describe("do-not-dial / retry / friendly status", () => {
  it("detects DNC values and headers", () => {
    expect(isDoNotDialValue("yes")).toBe(true);
    expect(isDoNotDialValue("")).toBe(false);
    expect(resolveDoNotDialHeader(["Phone", "Do Not Call"], { phone: "Phone" })).toBe("Do Not Call");
  });

  it("detects Retry status", () => {
    expect(isRetryStatus("Retry")).toBe(true);
    expect(isRetryStatus("Completed")).toBe(false);
  });

  it("maps friendly sheet statuses", () => {
    expect(friendlySheetStatus("enqueued")).toBe("Queued");
    expect(friendlySheetStatus("dialing")).toBe("Calling");
    expect(friendlySheetStatus("completed")).toBe("Completed");
    expect(friendlySheetStatus("no_answer")).toBe("No answer");
    expect(friendlySheetStatus("failed")).toBe("Failed");
  });
});

describe("sheet disposition / status labels", () => {
  const taxonomy = {
    OUTCOME: "Wrong number",
    primary: "OUTCOME",
    sub: "Wrong number",
    confidence: 1,
    summary: "Call reached a voicemail, not the intended person",
  };

  it("writes the sub label, not taxonomy JSON", () => {
    expect(formatSheetDisposition(taxonomy)).toBe("Wrong number");
    expect(formatSheetDisposition(JSON.stringify(taxonomy))).toBe("Wrong number");
    expect(formatSheetDisposition({
      OUTCOME: "Callback confirmed",
      primary: "OUTCOME",
      sub: "Callback confirmed",
    })).toBe("Callback confirmed");
  });

  it("uses outcome as Status when the call completed", () => {
    expect(resolveSheetStatusLabel("completed", "Wrong number")).toBe("Wrong number");
    expect(resolveSheetStatusLabel("failed", "Wrong number")).toBe("Failed");
    expect(resolveSheetStatusLabel("completed", "Callback confirmed", "Callback scheduled"))
      .toBe("Callback scheduled");
    expect(resolveSheetStatusLabel("completed", "Wrong number", "Booked")).toBe("Booked");
  });
});

describe("recording share tokens", () => {
  it("round-trips a valid token", () => {
    const token = issueRecordingShareToken(3355);
    expect(verifyRecordingShareToken(token)).toEqual({ callId: 3355 });
  });

  it("rejects tampered tokens", () => {
    const token = issueRecordingShareToken(3355);
    const tampered = token.slice(0, -2) + (token.endsWith("00") ? "11" : "00");
    expect(verifyRecordingShareToken(tampered)).toBeNull();
  });
});

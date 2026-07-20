import { describe, expect, it } from "vitest";
import {
  isCallbackDisposition,
  defaultNextDayCallbackAt,
  extractExplicitCallbackAt,
  formatSheetIst,
} from "./sheet-auto-call-loops.js";
import { phonesMatch } from "./google-sheets-helpers.js";

describe("isCallbackDisposition", () => {
  it("matches callback / call back / call later / schedule.*call", () => {
    expect(isCallbackDisposition("Customer asked for a callback")).toBe(true);
    expect(isCallbackDisposition("please call back tomorrow")).toBe(true);
    expect(isCallbackDisposition("Call later")).toBe(true);
    expect(isCallbackDisposition("Please schedule a call next week")).toBe(true);
  });

  it("ignores unrelated dispositions", () => {
    expect(isCallbackDisposition("Interested — booked a demo")).toBe(false);
    expect(isCallbackDisposition("Not interested")).toBe(false);
    expect(isCallbackDisposition("")).toBe(false);
    expect(isCallbackDisposition(null, undefined)).toBe(false);
  });

  it("scans across multiple text fields", () => {
    expect(isCallbackDisposition("Completed", "Said call me later")).toBe(true);
  });
});

describe("defaultNextDayCallbackAt", () => {
  it("returns next calendar day 10:00 Asia/Kolkata", () => {
    // Fixed instant: 2026-07-18 08:30 UTC = 14:00 IST → next day 10:00 IST
    const now = new Date("2026-07-18T08:30:00.000Z");
    const at = defaultNextDayCallbackAt(now);
    expect(formatSheetIst(at)).toMatch(/19 Jul 2026/i);
    // 10:00 IST = 04:30 UTC
    expect(at.toISOString()).toBe("2026-07-19T04:30:00.000Z");
  });
});

describe("extractExplicitCallbackAt", () => {
  it("reads structured disposition timestamps", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const d = extractExplicitCallbackAt({ callback_at: future });
    expect(d?.toISOString()).toBe(new Date(future).toISOString());
  });

  it("returns null when absent", () => {
    expect(extractExplicitCallbackAt({ outcome: "callback" })).toBeNull();
  });
});

describe("formatSheetIst / booking field", () => {
  it("formats meeting time in IST en-IN style", () => {
    const s = formatSheetIst("2026-07-20T04:30:00.000Z"); // 10:00 IST
    expect(s).toMatch(/20 Jul 2026/i);
    expect(s.toLowerCase()).toMatch(/10:00/);
  });
});

describe("inbound phone match helper", () => {
  it("matches sheet phone variants to inbound caller", () => {
    expect(phonesMatch("+91 98765 43210", "9876543210")).toBe(true);
    expect(phonesMatch("919876543210", "09876543210")).toBe(true);
  });
});

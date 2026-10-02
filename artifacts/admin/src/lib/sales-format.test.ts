import { describe, expect, it } from "vitest";
import {
  addDaysToDate,
  cellToIsoDateTime,
  formatCount,
  formatDateOnly,
  formatDateTimeIST,
  formatMinutes,
  formatPaise,
  formatPercent,
  formatRelative,
  formatTimeIST,
  humanize,
  istDateString,
  istLocalToIso,
  isoToIstLocal,
  isoWeekdayOf,
  paiseToRupeesInput,
  rupeesToPaise,
} from "./sales-format";

describe("formatPaise", () => {
  it("uses Indian digit grouping and hides zero paise", () => {
    expect(formatPaise(125_000_000)).toBe("₹12,50,000");
    expect(formatPaise(2_500_000)).toBe("₹25,000");
    expect(formatPaise(0)).toBe("₹0");
  });

  it("shows paise when not whole rupees", () => {
    expect(formatPaise(2_500_050)).toBe("₹25,000.50");
  });

  it("prefixes negatives (refunds) with a minus sign", () => {
    expect(formatPaise(-450_000)).toBe("-₹4,500");
  });

  it("returns the fallback for null, undefined and NaN", () => {
    expect(formatPaise(null)).toBe("—");
    expect(formatPaise(undefined, "n/a")).toBe("n/a");
    expect(formatPaise(Number.NaN)).toBe("—");
  });
});

describe("rupee input conversion", () => {
  it("parses rupee strings to integer paise", () => {
    expect(rupeesToPaise("25,000")).toBe(2_500_000);
    expect(rupeesToPaise("₹ 1,25,000.5")).toBe(12_500_050);
    expect(rupeesToPaise("4500.25")).toBe(450_025);
    expect(rupeesToPaise(100)).toBe(10_000);
  });

  it("rejects blank or malformed input", () => {
    expect(rupeesToPaise("")).toBeNull();
    expect(rupeesToPaise(null)).toBeNull();
    expect(rupeesToPaise("12.345")).toBeNull();
    expect(rupeesToPaise("abc")).toBeNull();
  });

  it("round-trips paise back to an input string", () => {
    expect(paiseToRupeesInput(2_500_000)).toBe("25000");
    expect(paiseToRupeesInput(2_500_050)).toBe("25000.50");
    expect(paiseToRupeesInput(null)).toBe("");
  });
});

describe("counts and percentages", () => {
  it("groups counts the Indian way", () => {
    expect(formatCount(1_234_567)).toBe("12,34,567");
    expect(formatCount(null)).toBe("—");
  });

  it("shows n/a for missing rates", () => {
    expect(formatPercent(0.375, 1)).toBe("37.5%");
    expect(formatPercent(null)).toBe("n/a");
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("n/a");
  });
});

describe("IST date and time", () => {
  it("formats UTC instants in Asia/Kolkata", () => {
    const text = formatDateTimeIST("2026-10-03T09:00:00Z");
    expect(text).toMatch(/3 Oct 2026/);
    expect(text).toMatch(/2:30/);
    expect(formatTimeIST("2026-10-03T18:45:00Z")).toMatch(/12:15/);
  });

  it("gives the IST calendar date across the UTC midnight boundary", () => {
    expect(istDateString("2026-10-02T19:00:00Z")).toBe("2026-10-03");
    expect(istDateString("2026-10-02T18:00:00Z")).toBe("2026-10-02");
  });

  it("formats calendar dates without shifting them", () => {
    expect(formatDateOnly("2026-11-01")).toMatch(/^Sun, 1 Nov,? 2026$/);
    expect(formatDateOnly("2026-11-01", "—", false)).toMatch(/^1 Nov,? 2026$/);
    expect(formatDateOnly("bad")).toBe("—");
  });

  it("does date arithmetic and ISO weekdays on plain dates", () => {
    expect(addDaysToDate("2026-10-31", 1)).toBe("2026-11-01");
    expect(isoWeekdayOf("2026-10-04")).toBe(7);
    expect(isoWeekdayOf("2026-10-05")).toBe(1);
  });

  it("converts datetime-local values between IST and UTC", () => {
    expect(istLocalToIso("2026-10-03T10:00")).toBe("2026-10-03T04:30:00.000Z");
    expect(isoToIstLocal("2026-10-03T04:30:00.000Z")).toBe("2026-10-03T10:00");
    expect(istLocalToIso("")).toBeNull();
    expect(istLocalToIso("03/10/2026")).toBeNull();
  });
});

describe("cellToIsoDateTime", () => {
  it("keeps values that already carry an offset", () => {
    expect(cellToIsoDateTime("2026-10-05T10:15:00+05:30")).toBe("2026-10-05T04:45:00.000Z");
    expect(cellToIsoDateTime("2026-10-05T04:45:00Z")).toBe("2026-10-05T04:45:00.000Z");
  });

  it("reads bare dates and times as IST", () => {
    expect(cellToIsoDateTime("2026-10-05 10:15")).toBe("2026-10-05T04:45:00.000Z");
    expect(cellToIsoDateTime("2026-10-05")).toBe("2026-10-04T18:30:00.000Z");
    expect(cellToIsoDateTime("5/10/2026 9:00")).toBe("2026-10-05T03:30:00.000Z");
  });

  it("returns null for blanks and garbage", () => {
    expect(cellToIsoDateTime("")).toBeNull();
    expect(cellToIsoDateTime("tomorrow")).toBeNull();
  });
});

describe("durations and labels", () => {
  it("formats minutes compactly", () => {
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(125)).toBe("2h 5m");
    expect(formatMinutes(60 * 24 * 3 + 60 * 4)).toBe("3d 4h");
  });

  it("describes relative times in both directions", () => {
    const now = new Date("2026-10-03T10:00:00Z");
    expect(formatRelative("2026-10-03T09:55:00Z", now)).toBe("5m ago");
    expect(formatRelative("2026-10-03T12:00:00Z", now)).toBe("in 2h");
    expect(formatRelative("2026-10-03T10:00:20Z", now)).toBe("just now");
  });

  it("humanizes snake_case values", () => {
    expect(humanize("first_month")).toBe("First month");
    expect(humanize(null)).toBe("");
  });
});

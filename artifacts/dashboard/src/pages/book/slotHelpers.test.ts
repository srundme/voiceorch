import { describe, it, expect } from "vitest";
import { addDays, formatDate, slotsByDay } from "./slotHelpers";

// ---------------------------------------------------------------------------
// addDays
// ---------------------------------------------------------------------------
describe("addDays", () => {
  it("advances the date by the given number of days", () => {
    const base = new Date("2026-06-01T00:00:00.000Z");
    const result = addDays(base, 13);
    expect(result.toISOString().slice(0, 10)).toBe("2026-06-14");
  });

  it("handles adding zero days", () => {
    const base = new Date("2026-06-15T12:00:00.000Z");
    const result = addDays(base, 0);
    expect(result.toISOString().slice(0, 10)).toBe("2026-06-15");
  });

  it("rolls over month boundaries correctly", () => {
    const base = new Date("2026-01-28T00:00:00.000Z");
    const result = addDays(base, 5);
    expect(result.toISOString().slice(0, 10)).toBe("2026-02-02");
  });

  it("rolls over year boundaries correctly", () => {
    const base = new Date("2026-12-30T00:00:00.000Z");
    const result = addDays(base, 3);
    expect(result.toISOString().slice(0, 10)).toBe("2027-01-02");
  });

  it("does not mutate the original date", () => {
    const base = new Date("2026-06-01T00:00:00.000Z");
    const original = base.toISOString();
    addDays(base, 5);
    expect(base.toISOString()).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------
describe("formatDate", () => {
  it("returns the UTC calendar date as YYYY-MM-DD", () => {
    const d = new Date("2026-06-15T00:00:00.000Z");
    expect(formatDate(d)).toBe("2026-06-15");
  });

  it("uses the UTC date, not a local offset", () => {
    // 23:30 UTC on Dec 31 is Jan 1 in UTC+01 or later — formatDate must
    // always return the UTC date (2026-12-31), not any local equivalent.
    const d = new Date("2026-12-31T23:30:00.000Z");
    expect(formatDate(d)).toBe("2026-12-31");
  });

  it("zero-pads single-digit months and days", () => {
    const d = new Date("2026-01-05T06:00:00.000Z");
    expect(formatDate(d)).toBe("2026-01-05");
  });
});

// ---------------------------------------------------------------------------
// slotsByDay
// ---------------------------------------------------------------------------
describe("slotsByDay", () => {
  it("returns an empty object for an empty slot list", () => {
    expect(slotsByDay([])).toEqual({});
  });

  it("groups slots on the same UTC day into one bucket", () => {
    const slots = [
      { slotStart: "2026-06-15T09:00:00.000Z" },
      { slotStart: "2026-06-15T10:00:00.000Z" },
      { slotStart: "2026-06-15T14:30:00.000Z" },
    ];
    const result = slotsByDay(slots);
    expect(Object.keys(result)).toEqual(["2026-06-15"]);
    expect(result["2026-06-15"]).toEqual([
      "2026-06-15T09:00:00.000Z",
      "2026-06-15T10:00:00.000Z",
      "2026-06-15T14:30:00.000Z",
    ]);
  });

  it("splits slots that fall on different UTC days", () => {
    const slots = [
      { slotStart: "2026-06-15T09:00:00.000Z" },
      { slotStart: "2026-06-16T09:00:00.000Z" },
    ];
    const result = slotsByDay(slots);
    expect(Object.keys(result).sort()).toEqual(["2026-06-15", "2026-06-16"]);
    expect(result["2026-06-15"]).toHaveLength(1);
    expect(result["2026-06-16"]).toHaveLength(1);
  });

  it("splits a slot spanning midnight UTC into the correct day", () => {
    // 23:30 UTC on June 15 belongs to June 15, NOT June 16.
    // A positive UTC offset (e.g. UTC+02) would see this as June 16 locally,
    // but slotsByDay must always bucket by UTC calendar date.
    const slots = [
      { slotStart: "2026-06-15T23:30:00.000Z" },
      { slotStart: "2026-06-16T00:00:00.000Z" },
    ];
    const result = slotsByDay(slots);
    expect(result["2026-06-15"]).toEqual(["2026-06-15T23:30:00.000Z"]);
    expect(result["2026-06-16"]).toEqual(["2026-06-16T00:00:00.000Z"]);
  });

  it("handles a single slot correctly", () => {
    const slots = [{ slotStart: "2026-07-04T15:00:00.000Z" }];
    const result = slotsByDay(slots);
    expect(result).toEqual({ "2026-07-04": ["2026-07-04T15:00:00.000Z"] });
  });

  it("preserves insertion order within a day bucket", () => {
    const slots = [
      { slotStart: "2026-06-15T08:00:00.000Z" },
      { slotStart: "2026-06-15T09:00:00.000Z" },
      { slotStart: "2026-06-15T10:00:00.000Z" },
    ];
    const result = slotsByDay(slots);
    expect(result["2026-06-15"]).toEqual([
      "2026-06-15T08:00:00.000Z",
      "2026-06-15T09:00:00.000Z",
      "2026-06-15T10:00:00.000Z",
    ]);
  });

  it("handles slots spread across many days", () => {
    const slots = [
      { slotStart: "2026-06-10T09:00:00.000Z" },
      { slotStart: "2026-06-12T09:00:00.000Z" },
      { slotStart: "2026-06-12T11:00:00.000Z" },
      { slotStart: "2026-06-14T09:00:00.000Z" },
    ];
    const result = slotsByDay(slots);
    expect(Object.keys(result).sort()).toEqual([
      "2026-06-10",
      "2026-06-12",
      "2026-06-14",
    ]);
    expect(result["2026-06-12"]).toHaveLength(2);
  });
});

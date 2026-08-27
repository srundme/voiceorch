import { describe, it, expect } from "vitest";
import {
  timeStringToMinutes,
  mergeAvailabilityWindows,
  isBookableSlotStart,
  dedupeAndSortSlots,
} from "./availability-windows.js";

describe("timeStringToMinutes", () => {
  it("parses HH:mm and HH:mm:ss", () => {
    expect(timeStringToMinutes("09:30")).toBe(570);
    expect(timeStringToMinutes("09:30:00")).toBe(570);
    expect(timeStringToMinutes("00:00")).toBe(0);
  });

  it("rejects garbage", () => {
    expect(timeStringToMinutes("")).toBeNull();
    expect(timeStringToMinutes("9am")).toBeNull();
    expect(timeStringToMinutes("25:00")).toBeNull();
    expect(timeStringToMinutes("09:75")).toBeNull();
  });
});

describe("mergeAvailabilityWindows", () => {
  it("keeps genuinely separate windows in order", () => {
    expect(
      mergeAvailabilityWindows([
        { startTime: "14:00", endTime: "18:00" },
        { startTime: "09:00", endTime: "13:00" },
      ]),
    ).toEqual([
      { startTime: "09:00", endTime: "13:00" },
      { startTime: "14:00", endTime: "18:00" },
    ]);
  });

  it("collapses duplicate rows", () => {
    expect(
      mergeAvailabilityWindows([
        { startTime: "09:00", endTime: "17:00" },
        { startTime: "09:00", endTime: "17:00" },
      ]),
    ).toEqual([{ startTime: "09:00", endTime: "17:00" }]);
  });

  it("merges overlapping windows into one", () => {
    expect(
      mergeAvailabilityWindows([
        { startTime: "09:00", endTime: "12:00" },
        { startTime: "11:00", endTime: "15:00" },
      ]),
    ).toEqual([{ startTime: "09:00", endTime: "15:00" }]);
  });

  it("merges touching windows so the slot grid stays continuous", () => {
    expect(
      mergeAvailabilityWindows([
        { startTime: "09:00", endTime: "13:00" },
        { startTime: "13:00", endTime: "17:00" },
      ]),
    ).toEqual([{ startTime: "09:00", endTime: "17:00" }]);
  });

  it("absorbs a window fully contained in another", () => {
    expect(
      mergeAvailabilityWindows([
        { startTime: "09:00", endTime: "18:00" },
        { startTime: "11:00", endTime: "12:00" },
      ]),
    ).toEqual([{ startTime: "09:00", endTime: "18:00" }]);
  });

  it("drops inverted, zero-length and unparseable windows", () => {
    expect(
      mergeAvailabilityWindows([
        { startTime: "17:00", endTime: "09:00" },
        { startTime: "10:00", endTime: "10:00" },
        { startTime: "abc", endTime: "10:00" },
      ]),
    ).toEqual([]);
  });
});

describe("isBookableSlotStart", () => {
  const now = new Date("2026-08-27T08:00:00Z");

  it("rejects slots that already started", () => {
    expect(isBookableSlotStart(new Date("2026-08-27T07:30:00Z"), now)).toBe(false);
  });

  it("accepts the current instant and future slots", () => {
    expect(isBookableSlotStart(new Date("2026-08-27T08:00:00Z"), now)).toBe(true);
    expect(isBookableSlotStart(new Date("2026-08-27T09:00:00Z"), now)).toBe(true);
  });

  it("honours a minimum lead time", () => {
    expect(isBookableSlotStart(new Date("2026-08-27T08:20:00Z"), now, 30)).toBe(false);
    expect(isBookableSlotStart(new Date("2026-08-27T08:40:00Z"), now, 30)).toBe(true);
  });
});

describe("dedupeAndSortSlots", () => {
  it("removes repeated instants and orders chronologically", () => {
    const slots = [
      { slotStart: new Date("2026-08-27T14:00:00Z"), slotEnd: new Date("2026-08-27T14:30:00Z") },
      { slotStart: new Date("2026-08-27T09:00:00Z"), slotEnd: new Date("2026-08-27T09:30:00Z") },
      { slotStart: new Date("2026-08-27T14:00:00Z"), slotEnd: new Date("2026-08-27T14:30:00Z") },
      { slotStart: new Date("2026-08-27T11:00:00Z"), slotEnd: new Date("2026-08-27T11:30:00Z") },
    ];

    expect(dedupeAndSortSlots(slots).map((s) => s.slotStart.toISOString())).toEqual([
      "2026-08-27T09:00:00.000Z",
      "2026-08-27T11:00:00.000Z",
      "2026-08-27T14:00:00.000Z",
    ]);
  });
});

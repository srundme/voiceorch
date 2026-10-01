import { describe, expect, it } from "vitest";
import { isScheduleDue, isValidHhmm, localParts, nextLocalMidnight, startOfLocalDay } from "./flow-time.js";

describe("flow-time", () => {
  // 2026-10-01 04:40 UTC = 10:10 IST (Thursday)
  const now = new Date("2026-10-01T04:40:00Z");

  it("reads local parts in the zone", () => {
    expect(localParts(now, "Asia/Kolkata")).toEqual({ date: "2026-10-01", hhmm: "10:10", weekday: 4 });
    expect(localParts(now, "America/New_York").date).toBe("2026-10-01");
    expect(localParts(now, "not/a-zone").hhmm).toBe("10:10");
  });

  it("finds local midnight boundaries", () => {
    expect(startOfLocalDay(now, "Asia/Kolkata").toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(nextLocalMidnight(now, "Asia/Kolkata").toISOString()).toBe("2026-10-01T18:30:00.000Z");
    expect(startOfLocalDay(now, "UTC").toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("validates HH:MM", () => {
    expect(isValidHhmm("09:30")).toBe(true);
    expect(isValidHhmm("9:30")).toBe(false);
    expect(isValidHhmm("24:00")).toBe(false);
  });

  it("schedule fires once per day after the time on chosen days", () => {
    const s = { time: "10:00", days: [4], timezone: "Asia/Kolkata" };
    expect(isScheduleDue(s, now, null)).toEqual({ due: true, localDate: "2026-10-01" });
    expect(isScheduleDue(s, now, "2026-10-01").due).toBe(false);
    expect(isScheduleDue({ ...s, time: "10:30" }, now, null).due).toBe(false);
    expect(isScheduleDue({ ...s, days: [1, 2] }, now, null).due).toBe(false);
    expect(isScheduleDue(undefined, now, null).due).toBe(false);
  });
});

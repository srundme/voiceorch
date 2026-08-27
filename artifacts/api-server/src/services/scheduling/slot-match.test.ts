import { describe, expect, it } from "vitest";
import { fromZonedTime } from "date-fns-tz";
import {
  extractIsoDateTime,
  wallClockDigits,
  parsePreferredInstant,
  findExactAvailableSlot,
} from "./slot-match.js";
import type { TimeSlot } from "./slot-engine.js";

const TZ = "Asia/Kolkata";

function slotAt(isoLocal: string): TimeSlot {
  const start = fromZonedTime(isoLocal, TZ);
  return { slotStart: start, slotEnd: new Date(start.getTime() + 30 * 60_000) };
}

describe("extractIsoDateTime", () => {
  it("pulls the ISO token off the spoken label the availability tool returns", () => {
    expect(
      extractIsoDateTime("2026-08-28T15:00:00+05:30 (Fri Aug 28 at 3:00 PM)"),
    ).toBe("2026-08-28T15:00:00+05:30");
  });
});

describe("findExactAvailableSlot", () => {
  const offered = [
    slotAt("2026-08-28T11:00:00"),
    slotAt("2026-08-28T15:00:00"),
    slotAt("2026-08-28T16:00:00"),
  ];
  const threePm = offered[1]!;

  it("matches the ISO the availability tool emitted", () => {
    const raw = "2026-08-28T15:00:00+05:30";
    const requested = parsePreferredInstant(raw, TZ)!;
    expect(findExactAvailableSlot(offered, requested, TZ, raw)?.slotStart.getTime())
      .toBe(threePm.slotStart.getTime());
  });

  it("parses the ISO+label string into the same instant as the slot", () => {
    const raw = "2026-08-28T15:00:00+05:30 (Fri Aug 28 at 3:00 PM)";
    expect(parsePreferredInstant(raw, TZ)?.getTime()).toBe(threePm.slotStart.getTime());
  });

  it("matches when the model glues the human label onto the ISO", () => {
    const raw = "2026-08-28T15:00:00+05:30 (Fri Aug 28 at 3:00 PM)";
    const requested = parsePreferredInstant(raw, TZ)!;
    expect(findExactAvailableSlot(offered, requested, TZ, raw)?.slotStart.getTime())
      .toBe(threePm.slotStart.getTime());
  });

  it("matches when the model swaps the offset for Z without converting the clock", () => {
    const raw = "2026-08-28T15:00:00Z";
    const requested = parsePreferredInstant(raw, TZ)!;
    expect(findExactAvailableSlot(offered, requested, TZ, raw)?.slotStart.getTime())
      .toBe(threePm.slotStart.getTime());
  });

  it("still matches when the requested instant is 1ms after the slot (old >= filter dropped this)", () => {
    const requested = new Date(threePm.slotStart.getTime() + 1);
    expect(findExactAvailableSlot(offered, requested, TZ)?.slotStart.getTime())
      .toBe(threePm.slotStart.getTime());
  });

  it("does not invent a slot that was never offered", () => {
    const raw = "2026-08-28T13:00:00+05:30";
    const requested = parsePreferredInstant(raw, TZ)!;
    expect(findExactAvailableSlot(offered, requested, TZ, raw)).toBeUndefined();
  });
});

describe("wallClockDigits", () => {
  it("reads the clock the model copied, not the offset it guessed", () => {
    expect(wallClockDigits("2026-08-28T15:00:00Z")).toBe("2026-08-28T15:00");
    expect(wallClockDigits("2026-08-28T15:00:00+05:30")).toBe("2026-08-28T15:00");
  });
});

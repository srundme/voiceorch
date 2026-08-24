import { describe, expect, it } from "vitest";
import { normalizeBookingDatetimeArgs } from "./booking-tool-args.js";

describe("normalizeBookingDatetimeArgs", () => {
  it("maps date_time / start_time / slot onto preferred_date", () => {
    expect(normalizeBookingDatetimeArgs({ date_time: "tomorrow 3pm" }).preferred_date).toBe("tomorrow 3pm");
    expect(normalizeBookingDatetimeArgs({ start_time: "2026-08-25T10:00:00+05:30" }).preferred_date)
      .toBe("2026-08-25T10:00:00+05:30");
    expect(normalizeBookingDatetimeArgs({ slot: "Friday 4pm" }).preferred_date).toBe("Friday 4pm");
  });

  it("does not overwrite an existing preferred_date", () => {
    expect(normalizeBookingDatetimeArgs({
      preferred_date: "2026-08-25T10:00:00+05:30",
      date_time: "ignored",
    }).preferred_date).toBe("2026-08-25T10:00:00+05:30");
  });

  it("leaves unrelated args untouched", () => {
    const args = { attendee_email: "a@b.com" };
    expect(normalizeBookingDatetimeArgs(args)).toEqual(args);
  });
});

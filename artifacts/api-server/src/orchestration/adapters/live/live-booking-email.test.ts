import { describe, expect, it } from "vitest";
import {
  LIVE_BOOKING_TRUTH_RULE,
  liveBookingConfirmEmailBlocked,
  liveBookingTruthRule,
  liveToolResultConfirmedBooking,
} from "./live-booking-email.js";

describe("liveBookingConfirmEmailBlocked", () => {
  it("blocks a confirmation email before a booking is confirmed", () => {
    expect(
      liveBookingConfirmEmailBlocked(
        { subject: "Meeting confirmed", body: "Your appointment is booked" },
        false,
      ),
    ).toBe(true);
  });

  it("allows the same email after booking_confirmed", () => {
    expect(
      liveBookingConfirmEmailBlocked(
        { subject: "Meeting confirmed", body: "Your appointment is booked" },
        true,
      ),
    ).toBe(false);
  });

  it("allows a non-booking email before booking", () => {
    expect(
      liveBookingConfirmEmailBlocked(
        { subject: "Hi", body: "Thanks for your time today" },
        false,
      ),
    ).toBe(false);
  });
});

describe("liveBookingTruthRule", () => {
  it("only states calendar truth — no email ritual", () => {
    expect(liveBookingTruthRule(false)).toBe(LIVE_BOOKING_TRUTH_RULE);
    expect(liveBookingTruthRule(true)).toBe(LIVE_BOOKING_TRUTH_RULE);
    expect(LIVE_BOOKING_TRUTH_RULE).toContain("booking_confirmed");
    expect(LIVE_BOOKING_TRUTH_RULE).not.toContain("email_confirmed");
    expect(LIVE_BOOKING_TRUTH_RULE).not.toContain("Do not ask the caller to provide an email");
  });
});

describe("liveToolResultConfirmedBooking", () => {
  it("detects booking_confirmed in tool output", () => {
    expect(liveToolResultConfirmedBooking({ output: "booking_confirmed: start=\"x\"" })).toBe(true);
    expect(liveToolResultConfirmedBooking({ output: "error: no slots" })).toBe(false);
  });
});

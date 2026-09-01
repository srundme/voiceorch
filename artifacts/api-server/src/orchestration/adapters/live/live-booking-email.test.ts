import { describe, expect, it } from "vitest";
import {
  liveBookingConfirmEmailBlocked,
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

describe("liveToolResultConfirmedBooking", () => {
  it("detects booking_confirmed in tool output", () => {
    expect(liveToolResultConfirmedBooking({ output: "booking_confirmed: start=\"x\"" })).toBe(true);
    expect(liveToolResultConfirmedBooking({ output: "error: no slots" })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { looksLikeBookingConfirmationEmail } from "./booking-email-guard.js";

describe("looksLikeBookingConfirmationEmail", () => {
  it("detects the false confirmation from call 13380", () => {
    expect(looksLikeBookingConfirmationEmail({
      subject: "AI Audit Confirmation - August 31st",
      body: "This email confirms your upcoming AI Audit scheduled for Monday, August 31st.",
    })).toBe(true);
  });

  it.each([
    "Appointment confirmed",
    "Your meeting is scheduled",
    "Demo booked for Friday",
    "Your calendar invite is on its way",
    "Here is your Google Meet link",
  ])("detects booking claim: %s", (subject) => {
    expect(looksLikeBookingConfirmationEmail({ subject })).toBe(true);
  });

  it.each([
    "Here is the brochure you requested",
    "Call summary",
    "Our meeting automation product",
    "Would you like to schedule a demo?",
    "Information about our AI Audit",
  ])("allows ordinary email: %s", (subject) => {
    expect(looksLikeBookingConfirmationEmail({ subject })).toBe(false);
  });

  it("ignores non-string values", () => {
    expect(looksLikeBookingConfirmationEmail({ subject: 123, body: null })).toBe(false);
  });
});

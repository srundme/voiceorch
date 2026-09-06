import { describe, expect, it } from "vitest";
import { looksLikeBookingConfirmationEmail, attachMeetLinkToEmailBody } from "./booking-email-guard.js";

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

describe("attachMeetLinkToEmailBody", () => {
  const link = "https://meet.google.com/abc-defg-hij";
  const promised = "Hi ben, your demo is confirmed. A Google Meet link will be included in this email. Looking forward to speaking with you!";

  it("replaces an empty Meet-link promise with the real URL", () => {
    expect(attachMeetLinkToEmailBody(promised, link)).toContain(link);
    expect(attachMeetLinkToEmailBody(promised, link)).not.toMatch(/will be included/i);
  });

  it("appends the URL on a confirmation that never mentioned Meet", () => {
    const out = attachMeetLinkToEmailBody("Your demo is confirmed for Friday at 10:00 AM IST.", link);
    expect(out).toContain(link);
  });

  it("does not rewrite a brochure email when no Meet URL exists", () => {
    const brochure = "Here is the brochure you requested.";
    expect(attachMeetLinkToEmailBody(brochure, null)).toBe(brochure);
  });

  it("strips the empty promise when there is no Meet URL", () => {
    const out = attachMeetLinkToEmailBody(promised, null);
    expect(out).not.toMatch(/will be included/i);
    expect(out).not.toContain("meet.google.com");
  });

  it("leaves a body that already has a Meet URL", () => {
    const withLink = `Join here: ${link}`;
    expect(attachMeetLinkToEmailBody(withLink, "https://meet.google.com/other")).toBe(withLink);
  });
});

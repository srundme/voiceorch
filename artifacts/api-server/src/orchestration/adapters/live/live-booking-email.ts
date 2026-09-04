import { looksLikeBookingConfirmationEmail } from "../../booking-email-guard.js";

const LIVE_BOOKING_TRUTH_BASE =
  "[BOOKING TRUTH] Never tell the caller an appointment is booked, scheduled, confirmed, or that a calendar invite / meeting link was sent unless a tool result in this call contains booking_confirmed. " +
  "If the booking tool returns an error, say the booking could not be completed and offer to try again or transfer. ";

export const LIVE_BOOKING_TRUTH_RULE =
  LIVE_BOOKING_TRUTH_BASE +
  "Spell the email back and get an explicit yes before calling book_appointment with email_confirmed=true.";

export function liveBookingTruthRule(askEmail: boolean): string {
  if (askEmail) return LIVE_BOOKING_TRUTH_RULE;
  return (
    LIVE_BOOKING_TRUTH_BASE +
    "Do not ask the caller to provide an email if you do not already have one from LEAD CONTEXT or prompt variables. If you have one, pass attendee_email. Confirming a known address is only if the agent instructions say to. Call book_appointment with their name and the chosen slot."
  );
}

export const LIVE_BOOKING_EMAIL_BLOCKED =
  "email_failed: no appointment was confirmed in this call, so a booking confirmation email was not sent. Do not claim that a meeting is booked or that a link will be sent. Tell the caller scheduling could not be completed.";

/** Same rule as classic: block mid-call booking-confirm emails until a book/reschedule tool succeeded. */
export function liveBookingConfirmEmailBlocked(
  args: Record<string, unknown>,
  schedulingActionConfirmed: boolean,
): boolean {
  return looksLikeBookingConfirmationEmail(args) && !schedulingActionConfirmed;
}

export function liveToolResultConfirmedBooking(result: Record<string, unknown>): boolean {
  const output = typeof result["output"] === "string" ? result["output"] : "";
  const err = typeof result["error"] === "string" ? result["error"] : "";
  return /booking_confirmed|reschedule_confirmed/.test(`${output} ${err}`);
}

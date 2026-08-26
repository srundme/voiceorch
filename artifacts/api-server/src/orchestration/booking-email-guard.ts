/**
 * Detect emails that claim a meeting/appointment was booked.
 *
 * `send_email` is intentionally generic, so most emails must remain allowed.
 * We only classify high-confidence booking confirmations here. The pipeline
 * blocks these unless a native booking/reschedule tool succeeded in this call.
 */
export function looksLikeBookingConfirmationEmail(args: Record<string, unknown>): boolean {
  const text = [
    args["subject"],
    args["body"],
    args["summary"],
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ");

  if (!text) return false;

  const bookingNoun = /\b(booking|appointment|meeting|demo|audit|calendar)\b/;
  const confirmationClaim =
    /\b(confirm(?:ed|ation|s)?|schedul(?:ed|ing)|booked|reserved|locked in)\b/;

  return (
    (bookingNoun.test(text) && confirmationClaim.test(text))
    || /\b(calendar invite|meeting link|meet link)\b/.test(text)
  );
}

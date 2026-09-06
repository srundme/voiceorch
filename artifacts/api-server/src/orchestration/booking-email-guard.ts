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

const MEET_LINK_PROMISE_RE = /a google meet link will be included[^.!?]*[.!?]?/gi;

/**
 * Mid-call send_email often claims a Meet link is attached, then sends only the
 * LLM's prose. Put the real booking URL in the body, or drop the empty promise.
 */
export function attachMeetLinkToEmailBody(
  body: string,
  meetLink: string | null | undefined,
): string {
  const text = body.trim();
  if (!text) return body;
  if (/https?:\/\/meet\.google\.com\//i.test(text)) return body;

  const link = (meetLink ?? "").trim();
  const promised = /a google meet link will be included/i.test(text);
  if (link) {
    if (promised) {
      return text.replace(MEET_LINK_PROMISE_RE, `Join Google Meet: ${link}.`).trim();
    }
    if (looksLikeBookingConfirmationEmail({ body: text })) {
      return `${text}\n\nJoin Google Meet: ${link}`;
    }
    return body;
  }

  if (!promised) return body;
  return text.replace(MEET_LINK_PROMISE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Whether book_appointment must collect a caller email.
 *
 * The LLM schema used to require attendee_email + a spell-back ritual. Agents
 * that never want that could not override it from the prompt or tool
 * description (call 20423). Collecting is now opt-in on the booking tool.
 *
 * When collection is off, a known email from lead source / prompt variables /
 * the resolved prompt is still used — the agent just must not ask for one.
 */

import { validateBookableEmail } from "./booking-email-validate.js";

export const GUEST_BOOKING_EMAIL_DOMAIN = "bookings.snapserve.local";

const PLACEHOLDER_EMAIL_DOMAINS = new Set([
  "example.com",
  "test.com",
  "placeholder.com",
  "example.org",
  "test.org",
]);

const PLACEHOLDER_EMAIL_LOCAL_PARTS = new Set([
  "example", "test", "fake", "dummy", "placeholder", "sample", "demo",
  "noreply", "no-reply", "null", "undefined", "none", "na", "n/a", "invalid",
]);

const PREFERRED_EMAIL_VAR_KEYS = [
  "email",
  "customer_email",
  "caller_email",
  "attendee_email",
  "mail_id",
  "email_id",
  "mail",
  "e_mail",
];

export type BookingEmailToolConfig = {
  collectAttendeeEmail?: boolean;
  defaultAttendeeEmail?: string | null;
};

/** True only when the agent explicitly opted into asking the caller. */
export function bookingAsksCallerForEmail(tool?: BookingEmailToolConfig | null): boolean {
  return tool?.collectAttendeeEmail === true;
}

export function isPlaceholderBookingEmail(email: string): boolean {
  const parts = email.toLowerCase().split("@");
  const local = parts[0] ?? "";
  const domain = parts[1] ?? "";
  if (PLACEHOLDER_EMAIL_DOMAINS.has(domain)) return true;
  if (PLACEHOLDER_EMAIL_LOCAL_PARTS.has(local)) return true;
  if (domain.endsWith(`.${GUEST_BOOKING_EMAIL_DOMAIN}`) || domain === GUEST_BOOKING_EMAIL_DOMAIN) {
    return true;
  }
  return false;
}

function usableKnownEmail(raw: string | null | undefined): string | null {
  const check = validateBookableEmail(String(raw ?? ""));
  if (!check.ok || isPlaceholderBookingEmail(check.email)) return null;
  return check.email;
}

/**
 * Prefer lead / sheet / {{email}} variable values. Does not scan free-form
 * prompt text (that can pick example.com from instructions).
 */
export function pickKnownBookingEmail(
  vars?: Record<string, string | null | undefined> | null,
): string | null {
  if (!vars) return null;
  for (const key of PREFERRED_EMAIL_VAR_KEYS) {
    const found = usableKnownEmail(vars[key]);
    if (found) return found;
  }
  for (const [key, value] of Object.entries(vars)) {
    if (!/mail/i.test(key)) continue;
    const found = usableKnownEmail(value);
    if (found) return found;
  }
  return null;
}

export function resolveDefaultBookingEmail(
  tool: BookingEmailToolConfig | null | undefined,
  callId: number,
): string {
  const configured = usableKnownEmail(tool?.defaultAttendeeEmail);
  if (configured) return configured;
  return `booking-guest+${callId}@${GUEST_BOOKING_EMAIL_DOMAIN}`;
}

function argsEmail(args: Record<string, unknown>): string | null {
  return usableKnownEmail(String(args["attendee_email"] ?? args["email"] ?? ""));
}

function emailAppearsInText(email: string, text?: string | null): boolean {
  if (!text) return false;
  return text.toLowerCase().includes(email.toLowerCase());
}

/** Fill attendee_email: spoken (opt-in) → lead/vars/prompt → tool default → guest. */
export function resolveBookingAttendeeEmail(opts: {
  tool?: BookingEmailToolConfig | null;
  args: Record<string, unknown>;
  callId: number;
  knownEmail?: string | null;
  knownSourceText?: string | null;
}): { email: string; fromCaller: boolean } {
  if (bookingAsksCallerForEmail(opts.tool)) {
    return {
      email: String(opts.args["attendee_email"] ?? opts.args["email"] ?? ""),
      fromCaller: true,
    };
  }

  const known = usableKnownEmail(opts.knownEmail);
  const fromArgs = argsEmail(opts.args);
  if (fromArgs && (fromArgs === known || emailAppearsInText(fromArgs, opts.knownSourceText))) {
    return { email: fromArgs, fromCaller: false };
  }
  if (known) return { email: known, fromCaller: false };
  return { email: resolveDefaultBookingEmail(opts.tool, opts.callId), fromCaller: false };
}

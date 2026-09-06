/**
 * Booking attendee email — prompt + lead only.
 *
 * 1. Lead source / {{email}} / an address written in the prompt → book with it.
 * 2. Else if the prompt says to collect email → take the address the caller gave.
 * 3. Else use a silent guest address so the calendar API can still create the event.
 *
 * No builder toggle. No default-email box. No spell-back ritual.
 */

import { validateBookableEmail } from "./booking-email-validate.js";

export const GUEST_BOOKING_EMAIL_DOMAIN = "bookings.snapserve.local";

const PLACEHOLDER_EMAIL_DOMAINS = new Set([
  "example.com",
  "test.com",
  "placeholder.com",
  "example.org",
  "test.org",
  "yourcompany.com",
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

const PROMPT_EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const COLLECT_EMAIL_RE =
  /(?:collect|ask(?:\s+for)?|get|take|capture|need|require)\s+(?:the\s+|their\s+|his\s+|her\s+|caller'?s\s+|customer'?s\s+)?(?:e-?mail|mail(?:\s*id)?|மெயில்|ஈமெயில்|ईमेल)|(?:e-?mail|mail)\s+address|(?:ask|collect).{0,32}(?:e-?mail|mail\s*id|மெயில்|ஈமெயில்|ईमेल)/i;

export type BookingEmailToolConfig = {
  collectAttendeeEmail?: boolean;
  defaultAttendeeEmail?: string | null;
};

export type BookingEmailAskCtx = {
  prompt?: string | null;
  knownEmail?: string | null;
};

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

/** True when the Talk/prompt text tells the agent to collect an email. */
export function promptAsksToCollectEmail(text?: string | null): boolean {
  if (!text) return false;
  return COLLECT_EMAIL_RE.test(text);
}

/** Real addresses written in the prompt (not example.com / placeholders). */
export function extractPromptBookingEmails(text?: string | null): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.match(PROMPT_EMAIL_RE) ?? []) {
    const found = usableKnownEmail(raw);
    if (!found) continue;
    const key = found.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(found);
  }
  return out;
}

export function pickKnownBookingEmail(
  vars?: Record<string, string | null | undefined> | null,
  sourceText?: string | null,
): string | null {
  if (vars) {
    for (const key of PREFERRED_EMAIL_VAR_KEYS) {
      const found = usableKnownEmail(vars[key]);
      if (found) return found;
    }
    for (const [key, value] of Object.entries(vars)) {
      if (!/mail/i.test(key)) continue;
      const found = usableKnownEmail(value);
      if (found) return found;
    }
  }
  return extractPromptBookingEmails(sourceText)[0] ?? null;
}

/**
 * Ask the caller only when the prompt says to collect AND no lead/prompt
 * address already exists. The old collectAttendeeEmail toggle is ignored.
 */
export function bookingAsksCallerForEmail(
  tool?: BookingEmailToolConfig | null,
  ctx?: BookingEmailAskCtx,
): boolean {
  void tool;
  const known = usableKnownEmail(ctx?.knownEmail) ?? extractPromptBookingEmails(ctx?.prompt)[0] ?? null;
  if (known) return false;
  return promptAsksToCollectEmail(ctx?.prompt);
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

/** Fill attendee_email: lead/prompt → caller (if prompt collects) → saved default → guest. */
export function resolveBookingAttendeeEmail(opts: {
  tool?: BookingEmailToolConfig | null;
  args: Record<string, unknown>;
  callId: number;
  knownEmail?: string | null;
  knownSourceText?: string | null;
}): { email: string; fromCaller: boolean } {
  const known =
    usableKnownEmail(opts.knownEmail)
    ?? extractPromptBookingEmails(opts.knownSourceText)[0]
    ?? null;
  if (known) return { email: known, fromCaller: false };

  const fromArgs = argsEmail(opts.args);
  const collecting = promptAsksToCollectEmail(opts.knownSourceText);
  if (collecting && fromArgs) return { email: fromArgs, fromCaller: true };
  if (collecting) return { email: "", fromCaller: true };

  return { email: resolveDefaultBookingEmail(opts.tool, opts.callId), fromCaller: false };
}

/**
 * Booking attendee-email hygiene — blocks incomplete / STT-mangled addresses
 * before native_booking or Cal.com create a calendar event (call 14390).
 */

const EMAIL_RE =
  /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/** Strip spoken-form noise and spaces STT inserts inside local-parts. */
export function sanitizeAttendeeEmail(raw: string): string {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  // Collapse "ram siva@…" / "ramfiva @ gmail.com" style STT gaps around @ and dots.
  s = s.replace(/\s*@\s*/g, "@").replace(/\s*\.\s*/g, ".");
  // Remove spaces inside the local-part only (domain spaces already collapsed above).
  const at = s.indexOf("@");
  if (at > 0) {
    let local = s.slice(0, at).replace(/\s+/g, "");
    const domain = s.slice(at + 1).replace(/\s+/g, "").toLowerCase();
    if (local.toLowerCase().startsWith("www.") && local.length > 7) {
      local = local.slice(4);
    }
    s = `${local}@${domain}`;
  }
  return s.trim();
}

export type BookableEmailResult =
  | { ok: true; email: string }
  | { ok: false; reason: string; detail: string };

/**
 * Structural gate for booking tools. Intentionally strict: a half-heard
 * "Ram Siva9166@" must never create a calendar invite.
 */
export function validateBookableEmail(raw: string): BookableEmailResult {
  const email = sanitizeAttendeeEmail(raw);
  if (!email) {
    return {
      ok: false,
      reason: "missing_email",
      detail: "attendee_email is empty. Ask the caller for their email address.",
    };
  }
  if (/\s/.test(email)) {
    return {
      ok: false,
      reason: "spaces_in_email",
      detail: "attendee_email still contains spaces after cleanup — ask the caller to spell it letter by letter.",
    };
  }
  if (!email.includes("@") || email.endsWith("@") || email.startsWith("@")) {
    return {
      ok: false,
      reason: "incomplete_email",
      detail: "attendee_email is incomplete (missing local-part or domain). Ask the caller to finish the full address including the domain (e.g. gmail.com).",
    };
  }
  const [local, domain] = email.split("@");
  if (!local || local.length < 2) {
    return {
      ok: false,
      reason: "short_local_part",
      detail: "attendee_email local-part is too short. Ask the caller to spell the full address.",
    };
  }
  if (!domain || !domain.includes(".") || domain.endsWith(".")) {
    return {
      ok: false,
      reason: "incomplete_domain",
      detail: "attendee_email domain is incomplete. Ask for the full domain (gmail.com, yahoo.com, etc.).",
    };
  }
  if (!EMAIL_RE.test(email)) {
    return {
      ok: false,
      reason: "invalid_email_format",
      detail: "attendee_email is not a valid email format. Spell it back with <spell>…</spell> and ask the caller to confirm before booking.",
    };
  }
  return { ok: true, email: email.toLowerCase() };
}

/** True when the model claims the caller confirmed the spelled-back address. */
export function isEmailConfirmedFlag(args: Record<string, unknown>): boolean {
  const v = args["email_confirmed"] ?? args["emailConfirmed"];
  return v === true || v === "true" || v === 1 || v === "1" || v === "yes";
}

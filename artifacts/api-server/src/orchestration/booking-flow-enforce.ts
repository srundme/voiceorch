/**
 * Hard booking-flow enforcement helpers.
 * Product rule: demo/schedule → check slots → confirm email → book → Meet mail if toggle on.
 * Talk alone must never claim "booked".
 */

import { looksLikeBookingTimeAnswer } from "./transcriptQuality.js";
import { sanitizeAttendeeEmail, validateBookableEmail } from "./booking-email-validate.js";

export type BookingFlowState = {
  availabilityChecked: boolean;
  lastSlotIso: string | null;
  candidateSlots: string[];
  pendingEmail: string | null;
  pendingName: string | null;
  emailSpellPending: boolean;
  emailConfirmed: boolean;
};

export function emptyBookingFlowState(): BookingFlowState {
  return {
    availabilityChecked: false,
    lastSlotIso: null,
    candidateSlots: [],
    pendingEmail: null,
    pendingName: null,
    emailSpellPending: false,
    emailConfirmed: false,
  };
}

/** Demo / meeting / appointment intent (EN + common Indian). */
export function looksLikeDemoOrScheduleIntent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (looksLikeBookingTimeAnswer(t)) return true;
  return (
    /\b(demo|appointment|meeting|schedule|book\s+(a\s+)?(call|meeting|slot|demo)|set\s+up\s+a\s+(call|meeting)|call\s+for\s+(a\s+)?demo|book\s+me|availability|available\s+slots?)\b/i.test(
      t,
    )
    || /(?:டெமோ|மீட்டிங்|அப்பாயிண்ட்|ஸ்லாட்|புக்|demo|meeting|appointment|स्लॉट|मीटिंग|अपॉइंटमेंट|बुक)/iu.test(t)
  );
}

/** Caller affirming a spelled-back email. */
export function looksLikeEmailConfirmationYes(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (
    /^(yes|yeah|yep|yup|correct|right|ok|okay|sure|perfect|that's right|that is right|confirmed)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  // Tamil/Hindi affirmations — avoid \\b (does not work reliably on Indic scripts).
  return /^(சரி|ஆமா|ஆம்|சரிய|ஓகே|ठीक|हाँ|हां|सही)([\s!.]|$)/iu.test(t);
}

/** Spoken claim that booking already happened / link already sent. */
export function looksLikeFalseBookingClaim(text: string): boolean {
  const t = text.toLowerCase();
  if (!t.trim()) return false;
  return (
    /\b(i('ve| have)?\s+booked|booking\s+(is\s+)?confirm|appointment\s+(is\s+)?(booked|scheduled|confirm)|meeting\s+(is\s+)?(booked|scheduled)|link\s+(has\s+been|was)\s+sent|sent\s+(you\s+)?(the\s+)?(meeting\s+)?link|calendar\s+invite\s+(has\s+been|was)\s+sent)\b/i.test(
      t,
    )
    || /(?:book\s*பண்ணி(?:ட்ட|டுற|ட்டேன்|ட்டேன்)|புக்\s*பண்ணி(?:ட்ட|டுற)|schedule\s*பண்ணி(?:ட்ட|டுற)|மீட்டிங்.?link|meeting.?link|இன்வைட்.?அனுப்பி)/iu.test(
      t,
    )
  );
}

const LOOSE_EMAIL_RE = /[a-z0-9][a-z0-9._%+-]{0,64}@[a-z0-9][a-z0-9.-]{0,126}\.[a-z]{2,}/gi;

export function extractEmailsFromText(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.match(LOOSE_EMAIL_RE) ?? []) {
    const check = validateBookableEmail(m);
    if (!check.ok) continue;
    const key = check.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(check.email);
  }
  return out;
}

const ISO_SLOT_RE = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))/g;

export function parseSlotIsoFromAvailabilityResult(result: string): string | null {
  const available = /requested_slot_available:\s*slot="([^"]+)"/i.exec(result);
  if (available?.[1]) return available[1];
  const alts = [...result.matchAll(ISO_SLOT_RE)].map((m) => m[1]!).filter(Boolean);
  return alts[0] ?? null;
}

export function parseIsoSlotsFromAvailabilityResult(result: string): string[] {
  const available = /requested_slot_available:\s*slot="([^"]+)"/i.exec(result);
  if (available?.[1]) return [available[1]];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of result.matchAll(ISO_SLOT_RE)) {
    const iso = m[1];
    if (!iso || seen.has(iso)) continue;
    seen.add(iso);
    out.push(iso);
  }
  return out;
}

export function updateBookingFlowFromToolResult(
  state: BookingFlowState,
  toolTypeOrName: string,
  result: string,
): BookingFlowState {
  const next = { ...state, candidateSlots: [...state.candidateSlots] };
  const key = toolTypeOrName.toLowerCase();
  const isCheck =
    key.includes("check_availability")
    || key === "native_check_availability"
    || /requested_slot_|available_slots/.test(result);
  if (isCheck) {
    next.availabilityChecked = true;
    const slots = parseIsoSlotsFromAvailabilityResult(result);
    if (slots.length) {
      next.candidateSlots = slots;
      next.lastSlotIso = slots[0] ?? null;
    }
  }
  const bookedEmail = /email="([^"]+)"/i.exec(result)?.[1];
  if (bookedEmail && /booking_confirmed|booking_pending/.test(result)) {
    const check = validateBookableEmail(bookedEmail);
    if (check.ok) next.pendingEmail = check.email;
  }
  return next;
}

export function updateBookingFlowFromAssistantText(
  state: BookingFlowState,
  assistantText: string,
): BookingFlowState {
  const next = { ...state };
  if (/<spell>|@\s*[a-z]|gmail|mail/i.test(assistantText)) {
    next.emailSpellPending = true;
  }
  const emails = extractEmailsFromText(assistantText.replace(/<[^>]+>/g, " "));
  if (emails[0]) next.pendingEmail = emails[0]!;
  return next;
}

export function updateBookingFlowFromUserTurn(
  state: BookingFlowState,
  userText: string,
  lastAssistantText: string,
): BookingFlowState {
  const next = { ...state, candidateSlots: [...state.candidateSlots] };
  const emails = extractEmailsFromText(userText);
  if (emails[0]) {
    next.pendingEmail = emails[0]!;
    // Fresh email — wait for spell-back confirmation unless they also affirm.
    next.emailConfirmed = false;
  }

  // Name heuristic: short non-email utterance while agent asked for name.
  const nameMatch = /(?:my name is|name is|நான்|என் பெயர்|मेरा नाम)\s+([^\n,.]+)/iu.exec(userText);
  if (nameMatch?.[1]) {
    const name = nameMatch[1]!.trim().replace(/[^\p{L}\p{N}\s.'-]/gu, "");
    if (name.length >= 2) next.pendingName = name;
  } else if (
    /(?:name|பெயர்|नाम)/i.test(lastAssistantText)
    && !emails.length
    && !looksLikeEmailConfirmationYes(userText)
    && userText.trim().split(/\s+/).length <= 4
    && !/@/.test(userText)
  ) {
    const name = userText.trim().replace(/[^\p{L}\p{N}\s.'-]/gu, "");
    if (name.length >= 2) next.pendingName = name;
  }

  const assistantAskedEmailConfirm =
    state.emailSpellPending
    || /<spell>|is that correct|சரியா|சரி தான|ठीक है ना|gmail/i.test(lastAssistantText);

  if (assistantAskedEmailConfirm && looksLikeEmailConfirmationYes(userText) && next.pendingEmail) {
    next.emailConfirmed = true;
    next.emailSpellPending = false;
  }

  // If user re-states a valid email and says yes in same breath.
  if (emails[0] && looksLikeEmailConfirmationYes(userText)) {
    next.emailConfirmed = true;
    next.emailSpellPending = false;
  }

  // Slot pick after alternatives: keep lastSlotIso if time answer matches a candidate label loosely.
  if (next.candidateSlots.length && looksLikeBookingTimeAnswer(userText)) {
    // Prefer keeping exact requested slot; otherwise leave first candidate —
    // forced book tool_choice lets the LLM pick the right ISO.
    next.lastSlotIso = next.lastSlotIso ?? next.candidateSlots[0] ?? null;
  }

  return next;
}

export function shouldForceCheckAvailability(opts: {
  state: BookingFlowState;
  userText: string;
  hasCheckTool: boolean;
  alreadyBooked: boolean;
}): boolean {
  if (!opts.hasCheckTool || opts.alreadyBooked) return false;
  if (opts.state.availabilityChecked && opts.state.lastSlotIso) return false;
  return looksLikeDemoOrScheduleIntent(opts.userText);
}

export function shouldForceBookAppointment(opts: {
  state: BookingFlowState;
  userText: string;
  hasBookTool: boolean;
  alreadyBooked: boolean;
}): boolean {
  if (!opts.hasBookTool || opts.alreadyBooked) return false;
  if (!opts.state.availabilityChecked || !opts.state.lastSlotIso) return false;
  if (!opts.state.pendingEmail) return false;
  // Force when email just confirmed, or already confirmed and user is progressing.
  if (opts.state.emailConfirmed) return true;
  if (looksLikeEmailConfirmationYes(opts.userText) && opts.state.emailSpellPending) return true;
  return false;
}

export function canAutoBook(opts: {
  state: BookingFlowState;
  alreadyBooked: boolean;
}): boolean {
  if (opts.alreadyBooked) return false;
  const s = opts.state;
  if (!s.availabilityChecked || !s.lastSlotIso) return false;
  if (!s.pendingEmail || !s.emailConfirmed) return false;
  if (!s.pendingName || s.pendingName.trim().length < 2) return false;
  return validateBookableEmail(s.pendingEmail).ok;
}

export function buildAutoBookArgs(state: BookingFlowState): Record<string, unknown> {
  return {
    attendee_name: state.pendingName ?? "Caller",
    attendee_email: sanitizeAttendeeEmail(state.pendingEmail ?? ""),
    email_confirmed: true,
    preferred_date: state.lastSlotIso,
  };
}

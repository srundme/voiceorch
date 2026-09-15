/**
 * Hard booking-flow enforcement helpers.
 * Product rule: demo/schedule → check slots → confirm email → book → Meet mail if toggle on.
 * Talk alone must never claim "booked".
 */

import { looksLikeBookingTimeAnswer } from "./transcriptQuality.js";
import {
  dropSuffixFragmentEmails,
  isEmailConfirmedFlag,
  isEmailLocalSuffixOf,
  preferCompleteEmail,
  sanitizeAttendeeEmail,
  validateBookableEmail,
} from "./booking-email-validate.js";
import { latinizeAttendeeName } from "./booking-attendee-name.js";
import { looksLikeSpokenEmailSpelling, reconstructSpokenEmail } from "./endpointing.js";

export type BookingFlowState = {
  availabilityChecked: boolean;
  lastSlotIso: string | null;
  /** True only after the caller (or a single-clock confirm) picked a slot. */
  slotLocked: boolean;
  candidateSlots: string[];
  pendingEmail: string | null;
  pendingName: string | null;
  emailSpellPending: boolean;
  emailConfirmed: boolean;
  /** Address we actually spelled to the caller — confirm applies only to this. */
  lastSpelledEmail: string | null;
  /** Native booking id after booking_confirmed / booking_pending. */
  lastBookingId: number | null;
  /** Address written on the calendar event (may lag pendingEmail after a change). */
  bookedEmail: string | null;
};

export function emptyBookingFlowState(): BookingFlowState {
  return {
    availabilityChecked: false,
    lastSlotIso: null,
    slotLocked: false,
    candidateSlots: [],
    pendingEmail: null,
    pendingName: null,
    emailSpellPending: false,
    emailConfirmed: false,
    lastSpelledEmail: null,
    lastBookingId: null,
    bookedEmail: null,
  };
}

/** Mid-funnel: slots / email / a booking id are already in play. */
export function bookingFlowNeedsGuides(state: BookingFlowState): boolean {
  return (
    state.availabilityChecked
    || state.slotLocked
    || !!state.pendingEmail
    || state.emailSpellPending
    || !!state.lastBookingId
    || state.candidateSlots.length > 0
  );
}

/** Cancel / change an existing appointment (EN + common Indian). */
export function looksLikeCancelOrRescheduleIntent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    /\b(cancel|reschedule|postpone|change\s+(my\s+)?(appointment|booking|meeting|slot|demo)|existing\s+(appointment|booking)|my\s+(appointment|booking))\b/i.test(
      t,
    )
    || /(?:ரத்து|ரீஷெட்யூல்|மாத்து|कैंसल|रद्द|रीशेड्यूल|रिसकेड्यूल)/iu.test(t)
  );
}

/**
 * Booking/scheduling phrasebooks belong on this turn only — not on hello / pitch / FAQ.
 */
export function shouldInjectSchedulingPhrasebook(_opts: {
  transcript: string;
  bookingFlow: BookingFlowState;
  activeReschedule?: boolean;
}): boolean {
  return false;
}

/** Callback / transfer / book — tool-preamble note only when a tool is likely. */
export function looksLikeImmediateToolIntent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (looksLikeDemoOrScheduleIntent(t) || looksLikeCancelOrRescheduleIntent(t)) return true;
  return (
    /\b(call\s+me\s+back|call\s+back|call\s+me\s+later|callback|call\s+me\s+tomorrow|call\s+me\s+at)\b/i.test(t)
    || /\b(transfer|connect\s+me|speak\s+to\s+(a\s+)?(human|person|agent|someone))\b/i.test(t)
    || /(?:திரும்ப\s+கால்|கால்பேக்|वापस\s+कॉल|कॉलबैक)/iu.test(t)
  );
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
  if (looksLikeEmailRejection(t)) return false;
  if (
    /^(yes|yeah|yep|yup|correct|right|ok|okay|sure|perfect|that's right|that is right|confirmed)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  // "Oh correct" / "okay correct" (call 17701) after a spell-back.
  if (/^(oh|ok|okay|ya|yeah)\s+(correct|right|yes)\b/i.test(t)) return true;
  // Tamil/Hindi affirmations — avoid \\b (does not work reliably on Indic scripts).
  return /^(சரி|ஆமா|ஆம்|சரிய|ஓகே|ठीक|हाँ|हां|सही)([\s!.]|$)/iu.test(t);
}

/** Caller saying the spelled address is wrong. */
export function looksLikeEmailRejection(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    /\b(no no|no again|nope|not that|not this|change (the |my )?(e-?mail|mail(\s*id)?)|different e-?mail|another e-?mail|wrong e-?mail|it'?s wrong|that'?s wrong|not correct|incorrect|illa illa)\b/i.test(t)
    || /\b(e-?mail|mail(\s*id)?)\s+(change|बदल)/i.test(t)
    || /(?:मेल|ईमेल).{0,16}(?:बदल|चेंज|change)|(?:बदल|चेंज|change).{0,16}(?:मेल|ईमेल|mail)/iu.test(t)
    || /(?:இல்ல|தவறு|गलत|नहीं)/u.test(t)
    // "No" + restated address: caller is rejecting the spelled-back fragment
    // (call 20113: "No K I S H O R E K U M A R R 307@gmail.com").
    || (/^(no|nah|nope)\b/i.test(t) && (/@/.test(t) || looksLikeSpokenEmailSpelling(t)))
  );
}

/** Bare "no" after we just spelled an address — not "no I want 10 AM". */
export function looksLikeBareEmailNo(text: string): boolean {
  return /^(no|nope|nah|no thanks|no sir|no madam)([!.\s]*)$/i.test(text.trim());
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
  const push = (raw: string) => {
    const check = validateBookableEmail(raw);
    if (!check.ok) return;
    const key = check.email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(check.email);
  };
  const afterCue = textAfterEmailCorrectionCue(text);
  const reconstructed = reconstructSpokenEmail(afterCue !== text ? afterCue : text)
    ?? (afterCue !== text ? reconstructSpokenEmail(text) : null);
  if (reconstructed) push(reconstructed);
  for (const m of text.match(LOOSE_EMAIL_RE) ?? []) push(m);
  return dropSuffixFragmentEmails(out);
}

/** Prefer the address spoken after "no / wrong / change email". */
function textAfterEmailCorrectionCue(text: string): string {
  const m =
    /\b(no no|no again|nope|not that|not this|it'?s wrong|that'?s wrong|wrong e-?mail|change (the |my )?(e-?mail|mail(\s*id)?)|different e-?mail|another e-?mail)\b/i.exec(
      text,
    );
  if (!m || m.index == null) return text;
  const after = text.slice(m.index + m[0].length).trim();
  return after.length >= 3 ? after : text;
}

/** Collapse `<spell>k a r r a j @ g m a i l . c o m</spell>` to a bookable address. */
export function emailFromSpellMarkup(text: string): string | null {
  const m = /<spell>([\s\S]*?)<\/spell>/i.exec(text);
  if (!m?.[1]) return null;
  const joined = m[1].replace(/\s+/g, "");
  const check = validateBookableEmail(joined);
  return check.ok ? check.email : null;
}

export function formatEmailForSpell(email: string): string {
  return email
    .trim()
    .toLowerCase()
    .split("")
    .map((ch) => (ch === "@" ? "@" : ch === "." ? "." : ch))
    .join(" ");
}

export function buildEmailSpellLine(email: string): string {
  return `Let me confirm your email. <spell>${formatEmailForSpell(email)}</spell> Is that correct?`;
}

export function shouldSpeakEmailSpell(state: BookingFlowState): boolean {
  if (!state.pendingEmail || state.emailConfirmed) return false;
  return state.lastSpelledEmail !== state.pendingEmail;
}

export function markEmailSpelled(state: BookingFlowState, email: string): BookingFlowState {
  const check = validateBookableEmail(email);
  if (!check.ok) return state;
  return {
    ...state,
    lastSpelledEmail: check.email,
    emailSpellPending: true,
    emailConfirmed: false,
  };
}

const ISO_SLOT_RE = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))/g;

export function parseSlotIsoFromAvailabilityResult(result: string): string | null {
  const available = /requested_slot_available:\s*slot="([^"]+)"/i.exec(result);
  if (available?.[1]) return available[1];
  const alts = [...result.matchAll(ISO_SLOT_RE)].map((m) => m[1]!).filter(Boolean);
  return alts[0] ?? null;
}

const SPOKEN_CLOCK_RE = /(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i;

export function parseSpokenClock(text: string): { hour24: number; minute: number } | null {
  const m = SPOKEN_CLOCK_RE.exec(text);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  if (!Number.isFinite(hour) || hour < 1 || hour > 12 || minute > 59) return null;
  const ap = m[3]!.replace(/\./g, "").toLowerCase();
  if (hour === 12) hour = ap === "am" ? 0 : 12;
  else if (ap === "pm") hour += 12;
  return { hour24: hour, minute };
}

/** Match "10 AM" / "10:10 AM" to the nearest offered ISO slot (call 17701). */
export function pickSlotIsoFromSpokenTime(
  text: string,
  candidateSlots: string[],
): string | null {
  if (!candidateSlots.length) return null;
  const clock = parseSpokenClock(text);
  if (!clock) return null;
  let best: { iso: string; score: number } | null = null;
  for (const iso of candidateSlots) {
    const hm = /T(\d{2}):(\d{2})/.exec(iso);
    if (!hm) continue;
    const score = Math.abs(Number(hm[1]) - clock.hour24) * 60 + Math.abs(Number(hm[2]) - clock.minute);
    if (!best || score < best.score) best = { iso, score };
  }
  return best && best.score <= 15 ? best.iso : null;
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
      if (next.slotLocked && next.lastSlotIso && slots.includes(next.lastSlotIso)) {
        // Keep the caller's pick across a re-check.
      } else {
        next.lastSlotIso = slots[0] ?? null;
        next.slotLocked = false;
      }
    }
  }
  const bookedEmail = /email="([^"]+)"/i.exec(result)?.[1];
  if (bookedEmail && /booking_confirmed|booking_pending|email_updated/.test(result)) {
    const check = validateBookableEmail(bookedEmail);
    if (check.ok) {
      next.pendingEmail = check.email;
      next.bookedEmail = check.email;
    }
  }
  const bookingIdMatch = /booking_id=(\d+)/i.exec(result);
  if (bookingIdMatch?.[1] && /booking_confirmed|booking_pending|email_updated/.test(result)) {
    next.lastBookingId = Number(bookingIdMatch[1]);
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
  // Do not copy an invented address out of the agent's mouth into pendingEmail
  // (call 17701: model spelled karthik@gmail.com after the caller said karraj).
  const spelled = emailFromSpellMarkup(assistantText);
  if (spelled && next.pendingEmail && spelled === next.pendingEmail) {
    next.lastSpelledEmail = spelled;
    next.emailSpellPending = true;
  } else if (spelled && next.pendingEmail && isEmailLocalSuffixOf(next.pendingEmail, spelled)) {
    // Agent spelled the completed address after STT compactified the local-part
    // (call 20113: pending 307@gmail.com, spoken kishorekumarr307@gmail.com).
    next.pendingEmail = spelled;
    next.lastSpelledEmail = spelled;
    next.emailSpellPending = true;
    next.emailConfirmed = false;
  }
  // One clock only — slot lists ("9:00 AM, 9:15 AM, 10:00 AM") must not
  // snap lastSlotIso back to the first offered time.
  const clockHits = assistantText.match(
    new RegExp(SPOKEN_CLOCK_RE.source, "gi"),
  )?.length ?? 0;
  if (clockHits === 1) {
    const spokenSlot = pickSlotIsoFromSpokenTime(assistantText, next.candidateSlots);
    if (spokenSlot) {
      next.lastSlotIso = spokenSlot;
      next.slotLocked = true;
    }
  }
  return next;
}

export function updateBookingFlowFromUserTurn(
  state: BookingFlowState,
  userText: string,
  lastAssistantText: string,
): BookingFlowState {
  const next = { ...state, candidateSlots: [...state.candidateSlots] };
  const assistantAskedEmailConfirm =
    state.emailSpellPending
    || !!state.lastSpelledEmail
    || /<spell>|is that correct|சரியா|சரி தான|ठीक है ना|gmail/i.test(lastAssistantText);
  const rejected =
    looksLikeEmailRejection(userText)
    || (assistantAskedEmailConfirm && looksLikeBareEmailNo(userText));

  const emails = extractEmailsFromText(userText);
  // After "no" / when STT still contains the old address, keep the last distinct one.
  // Suffix fragments of a reconstructed address are already dropped.
  const pickedEmail = emails.length > 1 || rejected
    ? emails[emails.length - 1]
    : emails[0];
  if (
    pickedEmail
    && next.pendingEmail
    && isEmailLocalSuffixOf(next.pendingEmail, pickedEmail)
  ) {
    next.pendingEmail = pickedEmail;
    next.emailConfirmed = false;
    next.emailSpellPending = false;
    next.lastSpelledEmail = null;
  } else if (pickedEmail && pickedEmail !== next.pendingEmail) {
    next.pendingEmail = pickedEmail;
    // Fresh email — must spell THIS address; a yes on the old one does not count.
    next.emailConfirmed = false;
    next.emailSpellPending = false;
    next.lastSpelledEmail = null;
  }

  if (rejected) {
    next.emailConfirmed = false;
    next.emailSpellPending = false;
    next.lastSpelledEmail = null;
    if (!pickedEmail) next.pendingEmail = null;
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

  const spelledMatches =
    !!next.pendingEmail
    && !!next.lastSpelledEmail
    && next.lastSpelledEmail === next.pendingEmail;

  if (
    spelledMatches
    && assistantAskedEmailConfirm
    && looksLikeEmailConfirmationYes(userText)
    && next.pendingEmail
  ) {
    next.emailConfirmed = true;
    next.emailSpellPending = false;
  }

  // Slot pick: map "10 AM" onto the offered list. Do not keep slots[0]
  // (call 17701: caller said 10 AM, auto-book used 9:00 AM).
  if (next.candidateSlots.length && looksLikeBookingTimeAnswer(userText)) {
    const picked = pickSlotIsoFromSpokenTime(userText, next.candidateSlots);
    if (picked) {
      next.lastSlotIso = picked;
      next.slotLocked = true;
    }
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

/** True when the caller picked a time, or only one slot was offered. */
export function hasChosenBookingSlot(state: BookingFlowState): boolean {
  if (!state.availabilityChecked || !state.lastSlotIso) return false;
  return state.slotLocked || state.candidateSlots.length === 1;
}

export function shouldForceBookAppointment(opts: {
  state: BookingFlowState;
  userText: string;
  hasBookTool: boolean;
  alreadyBooked: boolean;
  requireEmail?: boolean;
}): boolean {
  if (!opts.hasBookTool || opts.alreadyBooked) return false;
  if (!opts.state.availabilityChecked || !opts.state.lastSlotIso) return false;
  if (opts.requireEmail === false) {
    return hasChosenBookingSlot(opts.state)
      && Boolean(opts.state.pendingName && opts.state.pendingName.trim().length >= 2);
  }
  if (!opts.state.pendingEmail) return false;
  if (!opts.state.lastSpelledEmail || opts.state.lastSpelledEmail !== opts.state.pendingEmail) {
    return false;
  }
  // Force when email just confirmed, or already confirmed and user is progressing.
  if (opts.state.emailConfirmed) return true;
  if (looksLikeEmailConfirmationYes(opts.userText) && opts.state.emailSpellPending) return true;
  return false;
}

export function canAutoBook(opts: {
  state: BookingFlowState;
  alreadyBooked: boolean;
  requireEmail?: boolean;
}): boolean {
  if (opts.alreadyBooked) return false;
  const s = opts.state;
  if (!s.availabilityChecked || !s.lastSlotIso) return false;
  if (opts.requireEmail === false) {
    return hasChosenBookingSlot(s)
      && Boolean(s.pendingName && s.pendingName.trim().length >= 2);
  }
  if (!s.pendingEmail || !s.emailConfirmed) return false;
  if (!s.lastSpelledEmail || s.lastSpelledEmail !== s.pendingEmail) return false;
  if (!s.pendingName || s.pendingName.trim().length < 2) return false;
  return validateBookableEmail(s.pendingEmail).ok;
}

export function buildAutoBookArgs(state: BookingFlowState): Record<string, unknown> {
  const email = sanitizeAttendeeEmail(state.pendingEmail ?? "");
  return {
    attendee_name: latinizeAttendeeName(state.pendingName ?? "Caller", email),
    attendee_email: email,
    email_confirmed: true,
    preferred_date: state.lastSlotIso,
  };
}

/** Live / LLM book args: do not let a stale first-slot ISO override the caller's pick. */
export function applyLockedSlotToBookArgs(
  state: BookingFlowState,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!state.slotLocked || !state.lastSlotIso) return args;
  if (String(args["preferred_date"] ?? "") === state.lastSlotIso) return args;
  return { ...args, preferred_date: state.lastSlotIso };
}

/** Prefer the reconstructed full address over an STT/LLM local-part fragment. */
export function applyBookingEmailToBookArgs(
  state: BookingFlowState,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const raw = String(args["attendee_email"] ?? args["email"] ?? "");
  const chosen = preferCompleteEmail(raw, state.pendingEmail ?? "");
  const next = applyLockedSlotToBookArgs(state, chosen ? { ...args, attendee_email: chosen } : args);
  if (state.emailConfirmed || isEmailConfirmedFlag(args)) {
    return { ...next, email_confirmed: true };
  }
  return next;
}

/** Booking-confirm send_email must use the same address as the calendar event. */
export function applyBookingEmailToSendArgs(
  state: BookingFlowState,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const raw = String(args["to_email"] ?? args["email"] ?? "");
  const chosen = preferCompleteEmail(raw, state.pendingEmail ?? state.bookedEmail ?? "");
  if (!chosen) return args;
  return { ...args, to_email: chosen };
}

/** Caller confirmed a different address after the booking already landed. */
export function shouldUpdateBookedEmail(opts: {
  state: BookingFlowState;
  alreadyBooked: boolean;
}): boolean {
  if (!opts.alreadyBooked) return false;
  const s = opts.state;
  if (!s.lastBookingId || !s.pendingEmail || !s.emailConfirmed) return false;
  if (!s.lastSpelledEmail || s.lastSpelledEmail !== s.pendingEmail) return false;
  if (!validateBookableEmail(s.pendingEmail).ok) return false;
  return !s.bookedEmail || s.pendingEmail !== s.bookedEmail;
}

export function looksLikeBookOrRescheduleTool(toolName: string): boolean {
  const key = toolName.toLowerCase();
  return (
    key.includes("book_appointment")
    || key === "native_booking"
    || key.includes("reschedule")
  );
}

/** Match a spoken clock on `preferred_date` to a concrete slot (book/reschedule fallback). */
export function pickTimeSlotBySpokenClock<T>(
  preferredRaw: string | null | undefined,
  slots: T[],
  toIso: (slot: T) => string,
): T | undefined {
  if (!preferredRaw || !slots.length) return undefined;
  const isos = slots.map(toIso);
  const picked = pickSlotIsoFromSpokenTime(preferredRaw, isos);
  if (!picked) return undefined;
  const i = isos.indexOf(picked);
  return i >= 0 ? slots[i] : undefined;
}

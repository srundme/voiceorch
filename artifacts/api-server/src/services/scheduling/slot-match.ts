import { formatInTimeZone } from "date-fns-tz";
import { parseCallbackDateTime } from "../../lib/tz-datetime.js";
import type { TimeSlot } from "./slot-engine.js";

const ISO_IN_TEXT =
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/i;

/** Pull the first ISO datetime out of strings like `2026-08-28T15:00:00+05:30 (Fri Aug 28 at 3:00 PM)`. */
export function extractIsoDateTime(raw: string): string | null {
  const m = ISO_IN_TEXT.exec(raw.trim());
  if (!m) return null;
  return m[0].replace(" ", "T");
}

/** Calendar-local `yyyy-MM-ddTHH:mm` from the digits in a datetime, ignoring whatever offset the model attached. */
export function wallClockDigits(raw: string): string | null {
  const token = extractIsoDateTime(raw) ?? raw.trim();
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(token);
  if (!m) return null;
  return `${m[1]}T${m[2]}`;
}

export function parsePreferredInstant(raw: string, tz: string): Date | null {
  const token = extractIsoDateTime(raw) ?? raw.trim();
  return parseCallbackDateTime(token, tz);
}

/**
 * Find the slot the caller picked from a list we already offered.
 *
 * Models routinely rewrite the ISO we returned: they glue the spoken label on,
 * drop the offset, or swap `+05:30` for `Z` without converting the clock.
 * Matching only by UTC instant then misses the slot we just said was free, and
 * the agent tells the caller it is booked.
 */
export function findExactAvailableSlot(
  slots: TimeSlot[],
  requested: Date,
  tz: string,
  rawPreferred?: string,
  toleranceMs = 60_000,
): TimeSlot | undefined {
  const byInstant = slots.find(
    (s) => Math.abs(s.slotStart.getTime() - requested.getTime()) <= toleranceMs,
  );
  if (byInstant) return byInstant;

  const requestedClock = formatInTimeZone(requested, tz, "yyyy-MM-dd'T'HH:mm");
  const byCalendarClock = slots.find(
    (s) => formatInTimeZone(s.slotStart, tz, "yyyy-MM-dd'T'HH:mm") === requestedClock,
  );
  if (byCalendarClock) return byCalendarClock;

  if (!rawPreferred) return undefined;
  const digits = wallClockDigits(rawPreferred);
  if (!digits) return undefined;
  return slots.find(
    (s) => formatInTimeZone(s.slotStart, tz, "yyyy-MM-dd'T'HH:mm") === digits,
  );
}

/**
 * Pure date/slot utilities used by the public booking page.
 * Extracted here so they can be unit-tested independently of React.
 */

/** Return a new Date that is `days` calendar days after `date`. */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Format a Date as a YYYY-MM-DD string using its UTC calendar date.
 * This matches the wire format expected by the slots API.
 */
export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface SlotItem {
  slotStart: string;
}

/**
 * Group an array of slot objects by their UTC calendar date.
 *
 * Returns a Record<YYYY-MM-DD, slotStart[]> where each key is the UTC
 * date of the slot and the value is the ordered list of ISO start strings
 * for that day.
 *
 * Slots that fall on the same UTC date are merged into one bucket regardless
 * of what local timezone the caller is in.
 */
export function slotsByDay(slots: SlotItem[]): Record<string, string[]> {
  return slots.reduce<Record<string, string[]>>((acc, s) => {
    const day = new Date(s.slotStart).toISOString().slice(0, 10);
    if (!acc[day]) acc[day] = [];
    acc[day]!.push(s.slotStart);
    return acc;
  }, {});
}

/**
 * Returns true when a slot's start time is at or before `now`.
 *
 * Both arguments are compared as millisecond timestamps so timezone offsets
 * don't affect the result — the caller should pass the ISO string returned by
 * the server's `/scheduling/public/now` endpoint as `now`.
 */
export function isSlotPast(slotStart: string, now: string | Date): boolean {
  return new Date(slotStart).getTime() <= new Date(now).getTime();
}

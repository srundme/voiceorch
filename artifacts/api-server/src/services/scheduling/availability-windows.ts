/**
 * Pure helpers for availability window normalisation and slot hygiene.
 *
 * Kept free of DB imports so the slot math can be unit tested without a
 * database connection.
 */

export interface AvailabilityWindow {
  startTime: string; // "HH:mm" in the calendar's timezone
  endTime: string;   // "HH:mm" in the calendar's timezone
}

interface SlotLike {
  slotStart: Date;
  slotEnd: Date;
}

/** "HH:mm" (or "HH:mm:ss") → minutes from midnight, or null when unparseable. */
export function timeStringToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const mins = Number(m[2]);
  if (hours > 24 || mins > 59) return null;
  return hours * 60 + mins;
}

function minutesToTimeString(total: number): string {
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

/**
 * Collapses a day's availability windows into a set of non-overlapping,
 * chronologically ordered windows.
 *
 * A calendar can legitimately hold several rows for the same weekday (e.g.
 * 09:00–13:00 and 14:00–18:00), and duplicated or overlapping rows do occur
 * (re-saving working hours, or a morning window that bleeds into an afternoon
 * one).  Generating slots per raw window then produces duplicate and
 * overlapping offers, so windows are merged before any slot is built.
 *
 * Zero-length and inverted windows are dropped; touching windows
 * (13:00–14:00 + 14:00–17:00) are merged into one continuous window so the
 * slot grid does not restart mid-day.
 */
export function mergeAvailabilityWindows(windows: AvailabilityWindow[]): AvailabilityWindow[] {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const w of windows) {
    const start = timeStringToMinutes(w.startTime);
    const end = timeStringToMinutes(w.endTime);
    if (start == null || end == null) continue;
    if (end <= start) continue;
    ranges.push({ start, end });
  }

  ranges.sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  return merged.map((r) => ({
    startTime: minutesToTimeString(r.start),
    endTime: minutesToTimeString(r.end),
  }));
}

/**
 * True when a slot can still be booked, i.e. it starts at least `leadMinutes`
 * from now.  Working hours are day-shaped, so a plain day scan happily yields
 * slots that already passed earlier today — those must never be offered.
 */
export function isBookableSlotStart(slotStart: Date, now: Date, leadMinutes = 0): boolean {
  return slotStart.getTime() >= now.getTime() + leadMinutes * 60_000;
}

/**
 * Removes duplicate slots and returns them in chronological order.
 *
 * Slots are generated per day and per window, so without this the caller can be
 * offered "9:00 AM, 2:00 PM, 11:00 AM" out of order, and the same instant twice
 * when two windows produced it.
 */
export function dedupeAndSortSlots<T extends SlotLike>(slots: T[]): T[] {
  const seen = new Set<number>();
  const unique: T[] = [];
  for (const slot of slots) {
    const key = slot.slotStart.getTime();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(slot);
  }
  return unique.sort((a, b) => a.slotStart.getTime() - b.slotStart.getTime());
}

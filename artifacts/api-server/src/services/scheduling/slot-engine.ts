import { addMinutes, format, parseISO, isAfter, isBefore, eachDayOfInterval } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import {
  db,
  schedulingCalendarsTable,
  eventTypesTable,
  availabilitySchedulesTable,
  availabilityOverridesTable,
  bookingsTable,
} from "@workspace/db";
import { eq, and, lt, gt, or, sql } from "drizzle-orm";
import {
  mergeAvailabilityWindows,
  isBookableSlotStart,
  dedupeAndSortSlots,
} from "./availability-windows.js";

export interface TimeSlot {
  slotStart: Date;
  slotEnd: Date;
}

/**
 * Generates available booking slots for an event type within a date range.
 * All date logic is timezone-safe using date-fns-tz.
 *
 * Correctness notes:
 * - Existing booking overlap query uses an open-interval check (slotStart < rangeEnd
 *   AND slotEnd > rangeStart) so boundary-touching bookings are always fetched.
 * - Each existing booking's own event type buffers are used when computing its
 *   effective occupied window (not the requested event type's buffers).
 */
export async function getAvailableSlots(
  eventTypeId: number,
  startDateStr: string,
  endDateStr: string,
  opts: { now?: Date; leadMinutes?: number } = {},
): Promise<TimeSlot[]> {
  const now = opts.now ?? new Date();
  const leadMinutes = opts.leadMinutes ?? 0;
  const eventType = await db
    .select()
    .from(eventTypesTable)
    .where(eq(eventTypesTable.id, eventTypeId))
    .then((r) => r[0]);
  if (!eventType || !eventType.isActive) return [];

  const calendar = await db
    .select()
    .from(schedulingCalendarsTable)
    .where(eq(schedulingCalendarsTable.id, eventType.calendarId))
    .then((r) => r[0]);
  if (!calendar || !calendar.isActive) return [];

  const tz = calendar.timezone;
  const durationMins = eventType.durationMinutes;
  const bufferBefore = eventType.bufferBeforeMins;
  const bufferAfter = eventType.bufferAfterMins;

  // Construct range boundaries in the calendar's timezone directly from the
  // date strings — do NOT use parseISO (parses in JS runtime local tz) or
  // setHours (writes hours in JS runtime local tz) before calling fromZonedTime.
  const rangeStartUTC = fromZonedTime(`${startDateStr}T00:00:00`, tz);
  const rangeEndUTC   = fromZonedTime(`${endDateStr}T23:59:59`, tz);

  const schedules = await db
    .select()
    .from(availabilitySchedulesTable)
    .where(
      and(
        eq(availabilitySchedulesTable.calendarId, calendar.id),
        eq(availabilitySchedulesTable.isActive, true),
      ),
    );

  const overrides = await db
    .select()
    .from(availabilityOverridesTable)
    .where(eq(availabilityOverridesTable.calendarId, calendar.id));

  const overrideMap = new Map<string, (typeof overrides)[0]>();
  for (const ov of overrides) overrideMap.set(ov.date, ov);

  // Fetch all active bookings that OVERLAP with the range (open-interval check).
  // This catches bookings whose slotStart is before rangeEnd AND slotEnd is after rangeStart,
  // including ones that start or end exactly on a range boundary.
  const existingBookings = await db
    .select({
      slotStart: bookingsTable.slotStart,
      slotEnd: bookingsTable.slotEnd,
      eventTypeId: bookingsTable.eventTypeId,
    })
    .from(bookingsTable)
    .where(
      and(
        eq(bookingsTable.calendarId, calendar.id),
        or(eq(bookingsTable.status, "pending"), eq(bookingsTable.status, "confirmed")),
        lt(bookingsTable.slotStart, rangeEndUTC),
        gt(bookingsTable.slotEnd, rangeStartUTC),
      ),
    );

  // Fetch each booking's own event type to get its buffers (so conflicts are symmetric).
  const bookingEventTypeIds = [...new Set(existingBookings.map((b) => b.eventTypeId).filter((id): id is number => id != null))];
  const bookingEventTypes = bookingEventTypeIds.length
    ? await db
        .select({ id: eventTypesTable.id, bufferBeforeMins: eventTypesTable.bufferBeforeMins, bufferAfterMins: eventTypesTable.bufferAfterMins })
        .from(eventTypesTable)
        .where(sql`${eventTypesTable.id} = ANY(${sql.raw(`ARRAY[${bookingEventTypeIds.join(",")}]`)})`)
    : [];
  const etBufferMap = new Map(bookingEventTypes.map((et) => [et.id, et]));

  // Iterate over calendar-local date strings. parseISO here is safe — we only
  // use the resulting Date for day-of-week and yyyy-MM-dd formatting (both
  // runtime-tz agnostic for plain date strings without a time component).
  const days = eachDayOfInterval({ start: parseISO(startDateStr), end: parseISO(endDateStr) });
  const slots: TimeSlot[] = [];

  for (const day of days) {
    const dateStr = format(day, "yyyy-MM-dd");
    const override = overrideMap.get(dateStr);

    if (override?.isBlocked) continue;

    const dayOfWeek = day.getDay();
    let windows: Array<{ startTime: string; endTime: string }> = [];

    if (override && !override.isBlocked && override.startTime && override.endTime) {
      windows = [{ startTime: override.startTime, endTime: override.endTime }];
    } else {
      windows = schedules
        .filter((s) => s.dayOfWeek === dayOfWeek)
        .map((s) => ({ startTime: s.startTime, endTime: s.endTime }));
    }

    // Duplicate or overlapping working-hour rows would otherwise each generate
    // their own slot grid, offering the caller the same or overlapping times.
    windows = mergeAvailabilityWindows(windows);

    for (const window of windows) {
      // Build window boundaries anchored to the calendar's IANA timezone.
      // NEVER use new Date() + setHours() — setHours writes hours in the JS
      // runtime's local timezone (UTC on Railway), so fromZonedTime would then
      // re-interpret those UTC hours as calendar-local hours, producing a
      // doubly-shifted (wrong) UTC instant. Pass the ISO string directly.
      const windowStartUTC = fromZonedTime(`${dateStr}T${window.startTime}:00`, tz);
      const windowEndUTC   = fromZonedTime(`${dateStr}T${window.endTime}:00`, tz);

      let cursor = windowStartUTC;
      while (true) {
        const slotStart = cursor;
        const slotEnd = addMinutes(slotStart, durationMins);

        if (isAfter(slotEnd, windowEndUTC)) break;

        // A day scan reaches back to 00:00, so slots earlier today are still in
        // the grid — never offer a time that has already passed.
        if (!isBookableSlotStart(slotStart, now, leadMinutes)) {
          cursor = addMinutes(cursor, durationMins + bufferAfter);
          continue;
        }

        // Effective window occupied by THIS slot (including its own buffers)
        const effectiveStart = addMinutes(slotStart, -bufferBefore);
        const effectiveEnd = addMinutes(slotEnd, bufferAfter);

        // Count how many existing bookings overlap with the buffer-expanded slot window.
        // Also count exact-slot overlaps to enforce maxBookingsPerSlot capacity.
        let bufferConflicts = 0;
        let exactConflicts = 0;
        for (const b of existingBookings) {
          const bEt = b.eventTypeId != null ? etBufferMap.get(b.eventTypeId) : undefined;
          const bBefore = bEt?.bufferBeforeMins ?? 0;
          const bAfter = bEt?.bufferAfterMins ?? 0;
          const bEffectiveStart = addMinutes(b.slotStart, -bBefore);
          const bEffectiveEnd = addMinutes(b.slotEnd, bAfter);
          if (isOverlapping(effectiveStart, effectiveEnd, bEffectiveStart, bEffectiveEnd)) {
            bufferConflicts++;
          }
          if (isOverlapping(slotStart, slotEnd, b.slotStart, b.slotEnd)) {
            exactConflicts++;
          }
        }

        // A slot is available if:
        // - No buffer-window conflicts (ensures adjacency constraints are met), OR
        // - All buffer-window conflicts are exact-slot overlaps within capacity
        const withinCapacity = exactConflicts < eventType.maxBookingsPerSlot;
        const noBufferViolation = bufferConflicts === exactConflicts; // all conflicts are within the exact slot (same slot, multi-capacity)
        if (withinCapacity && noBufferViolation) {
          slots.push({ slotStart, slotEnd });
        }

        cursor = addMinutes(cursor, durationMins + bufferAfter);
      }
    }
  }

  return dedupeAndSortSlots(slots);
}

/**
 * Checks whether a given slot is available for booking.
 * Used inside DB transactions before insert/update.
 */
export async function isSlotAvailable(
  calendarId: number,
  slotStart: Date,
  slotEnd: Date,
  excludeBookingId?: number,
): Promise<boolean> {
  const conditions: any[] = [
    eq(bookingsTable.calendarId, calendarId),
    or(eq(bookingsTable.status, "pending"), eq(bookingsTable.status, "confirmed")),
    lt(bookingsTable.slotStart, slotEnd),
    gt(bookingsTable.slotEnd, slotStart),
  ];
  if (excludeBookingId !== undefined) {
    conditions.push(sql`${bookingsTable.id} != ${excludeBookingId}`);
  }

  const conflicts = await db
    .select({ id: bookingsTable.id })
    .from(bookingsTable)
    .where(and(...conditions))
    .limit(1);

  return conflicts.length === 0;
}

function isOverlapping(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return isBefore(aStart, bEnd) && isAfter(aEnd, bStart);
}

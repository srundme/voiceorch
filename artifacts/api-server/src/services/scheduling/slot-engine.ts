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
): Promise<TimeSlot[]> {
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

  const rangeStartLocal = parseISO(`${startDateStr}T00:00:00`);
  const rangeEndLocal = parseISO(`${endDateStr}T23:59:59`);

  const rangeStartUTC = fromZonedTime(rangeStartLocal, tz);
  const rangeEndUTC = fromZonedTime(rangeEndLocal, tz);

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
  const bookingEventTypeIds = [...new Set(existingBookings.map((b) => b.eventTypeId))];
  const bookingEventTypes = bookingEventTypeIds.length
    ? await db
        .select({ id: eventTypesTable.id, bufferBeforeMins: eventTypesTable.bufferBeforeMins, bufferAfterMins: eventTypesTable.bufferAfterMins })
        .from(eventTypesTable)
        .where(sql`${eventTypesTable.id} = ANY(${sql.raw(`ARRAY[${bookingEventTypeIds.join(",")}]`)})`)
    : [];
  const etBufferMap = new Map(bookingEventTypes.map((et) => [et.id, et]));

  const days = eachDayOfInterval({ start: rangeStartLocal, end: rangeEndLocal });
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

    for (const window of windows) {
      const [startHour, startMin] = window.startTime.split(":").map(Number);
      const [endHour, endMin] = window.endTime.split(":").map(Number);

      const windowStartLocal = new Date(day);
      windowStartLocal.setHours(startHour!, startMin!, 0, 0);
      const windowEndLocal = new Date(day);
      windowEndLocal.setHours(endHour!, endMin!, 0, 0);

      const windowStartUTC = fromZonedTime(windowStartLocal, tz);
      const windowEndUTC = fromZonedTime(windowEndLocal, tz);

      let cursor = windowStartUTC;
      while (true) {
        const slotStart = cursor;
        const slotEnd = addMinutes(slotStart, durationMins);

        if (isAfter(slotEnd, windowEndUTC)) break;

        // Effective window occupied by THIS slot (including its own buffers)
        const effectiveStart = addMinutes(slotStart, -bufferBefore);
        const effectiveEnd = addMinutes(slotEnd, bufferAfter);

        // Count how many existing bookings overlap with the buffer-expanded slot window.
        // Also count exact-slot overlaps to enforce maxBookingsPerSlot capacity.
        let bufferConflicts = 0;
        let exactConflicts = 0;
        for (const b of existingBookings) {
          const bEt = etBufferMap.get(b.eventTypeId);
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

  return slots;
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

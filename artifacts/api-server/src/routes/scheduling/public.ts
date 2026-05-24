import { Router, type IRouter } from "express";
import { format, addMinutes } from "date-fns";
import { eq, and, or, sql } from "drizzle-orm";
import { db, eventTypesTable, schedulingCalendarsTable, bookingsTable } from "@workspace/db";
import { getAvailableSlots } from "../../services/scheduling/slot-engine.js";
import { sendBookingCreatedEmail } from "../../services/scheduling/notifications.js";
import { dispatchSchedulingWebhooks } from "./webhooks.js";
import {
  GetPublicEventTypeParams,
  GetPublicSlotsResponse,
  GetPublicEventTypeResponse,
  CreatePublicBookingBody,
  GetBookingResponse,
} from "@workspace/api-zod";
import { buildSlotLockKey } from "../../services/scheduling/lock.js";

const router: IRouter = Router();

router.get("/scheduling/public/event-types/:slug", async (req, res): Promise<void> => {
  const params = GetPublicEventTypeParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [eventType] = await db.select().from(eventTypesTable)
    .where(eq(eventTypesTable.slug, params.data.slug));
  if (!eventType || !eventType.isActive) { res.status(404).json({ error: "Event type not found" }); return; }

  res.json(GetPublicEventTypeResponse.parse({
    id: eventType.id,
    calendarId: eventType.calendarId,
    name: eventType.name,
    slug: eventType.slug,
    description: eventType.description ?? null,
    durationMinutes: eventType.durationMinutes,
    confirmationMode: eventType.confirmationMode,
  }));
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get("/scheduling/public/slots", async (req, res): Promise<void> => {
  const { slug, startDate, endDate } = req.query as Record<string, string>;
  if (!slug) { res.status(400).json({ error: "slug is required" }); return; }
  if (!startDate || !DATE_RE.test(startDate)) {
    res.status(400).json({ error: "startDate must be YYYY-MM-DD" }); return;
  }
  if (!endDate || !DATE_RE.test(endDate)) {
    res.status(400).json({ error: "endDate must be YYYY-MM-DD" }); return;
  }

  const [eventType] = await db.select().from(eventTypesTable)
    .where(eq(eventTypesTable.slug, slug));
  if (!eventType || !eventType.isActive) { res.status(404).json({ error: "Event type not found" }); return; }

  const slots = await getAvailableSlots(eventType.id, startDate, endDate);
  res.json(GetPublicSlotsResponse.parse(slots.map(s => ({
    slotStart: s.slotStart.toISOString(),
    slotEnd: s.slotEnd.toISOString(),
  }))));
});

router.post("/scheduling/public/bookings", async (req, res): Promise<void> => {
  const parsed = CreatePublicBookingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [eventType] = await db.select().from(eventTypesTable)
    .where(eq(eventTypesTable.slug, parsed.data.eventTypeSlug));
  if (!eventType || !eventType.isActive) { res.status(404).json({ error: "Event type not found" }); return; }

  const [calendar] = await db.select().from(schedulingCalendarsTable)
    .where(eq(schedulingCalendarsTable.id, eventType.calendarId));
  if (!calendar || !calendar.isActive) { res.status(404).json({ error: "Calendar not available" }); return; }

  const slotStart = new Date(parsed.data.slotStart);
  const slotEnd = addMinutes(slotStart, eventType.durationMinutes);
  const lockKey = buildSlotLockKey(calendar.id, slotStart);

  let booking: typeof bookingsTable.$inferSelect | undefined;
  let lockConflict = false;

  // Validate the requested slot against computed availability windows
  const availableSlots = await getAvailableSlots(
    eventType.id,
    format(slotStart, "yyyy-MM-dd"),
    format(slotStart, "yyyy-MM-dd"),
  );
  const slotIsAvailable = availableSlots.some(
    (s) => s.slotStart.getTime() === slotStart.getTime(),
  );
  if (!slotIsAvailable) {
    res.status(409).json({ error: "This slot is not available — please choose another" });
    return;
  }

  await db.transaction(async (tx) => {
    const lockResult = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS acquired`
    );
    const acquired = (lockResult.rows[0] as any)?.acquired === true;
    if (!acquired) { lockConflict = true; return; }

    // Buffer-aware in-transaction conflict check
    const bufBefore = addMinutes(slotStart, -eventType.bufferBeforeMins);
    const bufAfter = addMinutes(slotEnd, eventType.bufferAfterMins);

    const overlapCount = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(bookingsTable)
      .where(
        and(
          eq(bookingsTable.calendarId, calendar.id),
          or(eq(bookingsTable.status, "pending"), eq(bookingsTable.status, "confirmed")),
          sql`${bookingsTable.slotStart} < ${bufAfter}`,
          sql`${bookingsTable.slotEnd} > ${bufBefore}`,
        ),
      )
      .then((r) => r[0]?.count ?? 0);

    // Enforce maxBookingsPerSlot capacity
    const exactOverlapCount = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(bookingsTable)
      .where(
        and(
          eq(bookingsTable.calendarId, calendar.id),
          or(eq(bookingsTable.status, "pending"), eq(bookingsTable.status, "confirmed")),
          sql`${bookingsTable.slotStart} < ${slotEnd}`,
          sql`${bookingsTable.slotEnd} > ${slotStart}`,
        ),
      )
      .then((r) => r[0]?.count ?? 0);

    // Reject if capacity is full, OR if a buffer-adjacent (non-same-slot) booking exists
    if (exactOverlapCount >= eventType.maxBookingsPerSlot || overlapCount > exactOverlapCount) {
      lockConflict = true; return;
    }

    const [inserted] = await tx.insert(bookingsTable).values({
      eventTypeId: eventType.id,
      calendarId: calendar.id,
      callId: null,
      userId: calendar.userId,
      attendeeName: parsed.data.attendeeName,
      attendeeEmail: parsed.data.attendeeEmail,
      attendeeNotes: parsed.data.attendeeNotes ?? null,
      slotStart,
      slotEnd,
      status: eventType.confirmationMode === "instant" ? "confirmed" : "pending",
      bookedVia: "web",
    }).returning();
    booking = inserted;
  });

  if (lockConflict || !booking) {
    res.status(409).json({ error: "This slot is no longer available — please choose another" });
    return;
  }

  void sendBookingCreatedEmail({
    attendeeName: booking.attendeeName,
    attendeeEmail: booking.attendeeEmail,
    eventTypeName: eventType.name,
    slotStart: booking.slotStart,
    slotEnd: booking.slotEnd,
    timezone: calendar.timezone,
    bookingId: booking.id,
    notes: booking.attendeeNotes,
  });
  void dispatchSchedulingWebhooks(calendar.userId, "scheduling.booking.created", {
    booking: {
      ...booking,
      slotStart: booking.slotStart.toISOString(),
      slotEnd: booking.slotEnd.toISOString(),
      cancelledAt: booking.cancelledAt?.toISOString() ?? null,
      createdAt: booking.createdAt.toISOString(),
      updatedAt: booking.updatedAt.toISOString(),
    },
  });

  res.status(201).json(GetBookingResponse.parse({
    ...booking,
    slotStart: booking.slotStart.toISOString(),
    slotEnd: booking.slotEnd.toISOString(),
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString(),
  }));
});

export default router;

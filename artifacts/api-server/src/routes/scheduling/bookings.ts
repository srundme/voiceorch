import { Router, type IRouter } from "express";
import { eq, and, or, gte, lte, sql } from "drizzle-orm";
import { db, bookingsTable, eventTypesTable, schedulingCalendarsTable } from "@workspace/db";
import { requireAuth } from "../../middlewares/requireAuth.js";
import {
  CreateBookingBody,
  UpdateBookingBody,
  GetBookingParams,
  UpdateBookingParams,
  ListBookingsQueryParams,
  ListBookingsResponse,
  GetBookingResponse,
  UpdateBookingResponse,
} from "@workspace/api-zod";
import { buildSlotLockKey } from "../../services/scheduling/lock.js";
import { getAvailableSlots, isSlotAvailable } from "../../services/scheduling/slot-engine.js";
import {
  sendBookingCreatedEmail,
  sendBookingCancelledEmail,
  sendBookingRescheduledEmail,
  sendBookingConfirmedEmail,
} from "../../services/scheduling/notifications.js";
import { dispatchSchedulingWebhooks } from "./webhooks.js";
import { addMinutes, format } from "date-fns";

const router: IRouter = Router();

function formatBooking(b: typeof bookingsTable.$inferSelect) {
  return {
    ...b,
    slotStart: b.slotStart.toISOString(),
    slotEnd: b.slotEnd.toISOString(),
    cancelledAt: b.cancelledAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

router.get("/scheduling/bookings", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const qp = ListBookingsQueryParams.safeParse(req.query);
  if (!qp.success) { res.status(400).json({ error: qp.error.message }); return; }

  const conditions: any[] = [eq(bookingsTable.userId, clerkId)];
  if (qp.data.status) conditions.push(eq(bookingsTable.status, qp.data.status));
  if (qp.data.calendarId != null) conditions.push(eq(bookingsTable.calendarId, qp.data.calendarId));
  if (qp.data.startDate) conditions.push(gte(bookingsTable.slotStart, new Date(qp.data.startDate)));
  if (qp.data.endDate) conditions.push(lte(bookingsTable.slotStart, new Date(`${qp.data.endDate}T23:59:59Z`)));

  const rows = await db.select().from(bookingsTable)
    .where(and(...conditions))
    .orderBy(bookingsTable.slotStart);
  res.json(ListBookingsResponse.parse(rows.map(formatBooking)));
});

router.post("/scheduling/bookings", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = CreateBookingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [eventType] = await db.select().from(eventTypesTable)
    .where(and(eq(eventTypesTable.id, parsed.data.eventTypeId), eq(eventTypesTable.userId, clerkId)));
  if (!eventType) { res.status(404).json({ error: "Event type not found" }); return; }

  const [calendar] = await db.select().from(schedulingCalendarsTable)
    .where(eq(schedulingCalendarsTable.id, eventType.calendarId));
  if (!calendar) { res.status(404).json({ error: "Calendar not found" }); return; }

  const slotStart = new Date(parsed.data.slotStart);
  const slotEnd = addMinutes(slotStart, eventType.durationMinutes);
  const lockKey = buildSlotLockKey(calendar.id, slotStart);

  let booking: typeof bookingsTable.$inferSelect | undefined;
  let lockConflict = false;

  // Validate that the requested slot appears in the computed availability windows
  const availableSlots = await getAvailableSlots(
    eventType.id,
    format(slotStart, "yyyy-MM-dd"),
    format(slotStart, "yyyy-MM-dd"),
  );
  const slotIsAvailable = availableSlots.some(
    (s) => s.slotStart.getTime() === slotStart.getTime(),
  );
  if (!slotIsAvailable) {
    res.status(409).json({ error: "Requested slot is not available" });
    return;
  }

  await db.transaction(async (tx) => {
    const lockResult = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS acquired`
    );
    const acquired = (lockResult.rows[0] as any)?.acquired === true;
    if (!acquired) { lockConflict = true; return; }

    // Buffer-aware in-transaction conflict check:
    // Use the requesting event type's buffer to expand the window checked against
    // existing booking slot ranges. This catches adjacent-buffer concurrent races.
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

    // For exact slot overlap (slotStart→slotEnd), enforce maxBookingsPerSlot capacity
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

    // Reject if:
    // - Capacity is full (exactOverlapCount >= maxBookingsPerSlot), OR
    // - There is a buffer-adjacent booking (overlapCount > exactOverlapCount means
    //   a booking is within buffer range but NOT the same slot window — violates buffer rules)
    if (exactOverlapCount >= eventType.maxBookingsPerSlot || overlapCount > exactOverlapCount) {
      lockConflict = true; return;
    }

    const [inserted] = await tx.insert(bookingsTable).values({
      eventTypeId: eventType.id,
      calendarId: calendar.id,
      callId: parsed.data.callId ?? null,
      userId: clerkId,
      attendeeName: parsed.data.attendeeName,
      attendeeEmail: parsed.data.attendeeEmail,
      attendeeNotes: parsed.data.attendeeNotes ?? null,
      slotStart,
      slotEnd,
      status: eventType.confirmationMode === "instant" ? "confirmed" : "pending",
      bookedVia: parsed.data.bookedVia ?? "api",
    }).returning();
    booking = inserted;
  });

  if (lockConflict || !booking) {
    res.status(409).json({ error: "Slot already booked — please try another slot" });
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
  void dispatchSchedulingWebhooks(clerkId, "scheduling.booking.created", { booking: formatBooking(booking) });

  res.status(201).json(GetBookingResponse.parse(formatBooking(booking)));
});

router.get("/scheduling/bookings/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = GetBookingParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.select().from(bookingsTable)
    .where(and(eq(bookingsTable.id, params.data.id), eq(bookingsTable.userId, clerkId)));
  if (!row) { res.status(404).json({ error: "Booking not found" }); return; }
  res.json(GetBookingResponse.parse(formatBooking(row)));
});

router.patch("/scheduling/bookings/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = UpdateBookingParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateBookingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [existing] = await db.select().from(bookingsTable)
    .where(and(eq(bookingsTable.id, params.data.id), eq(bookingsTable.userId, clerkId)));
  if (!existing) { res.status(404).json({ error: "Booking not found" }); return; }

  const [eventType] = await db.select().from(eventTypesTable).where(eq(eventTypesTable.id, existing.eventTypeId));
  const [calendar] = await db.select().from(schedulingCalendarsTable).where(eq(schedulingCalendarsTable.id, existing.calendarId));

  if (parsed.data.status === "rescheduled" && parsed.data.slotStart) {
    const newSlotStart = new Date(parsed.data.slotStart);
    const newSlotEnd = addMinutes(newSlotStart, eventType?.durationMinutes ?? 30);
    const lockKey = buildSlotLockKey(existing.calendarId, newSlotStart);

    // Validate new slot against computed availability windows
    const availableSlots = await getAvailableSlots(
      existing.eventTypeId,
      format(newSlotStart, "yyyy-MM-dd"),
      format(newSlotStart, "yyyy-MM-dd"),
    );
    const slotIsAvailable = availableSlots.some(
      (s) => s.slotStart.getTime() === newSlotStart.getTime(),
    );
    if (!slotIsAvailable) {
      res.status(409).json({ error: "Requested slot is not available" });
      return;
    }

    // Reschedule semantics:
    // - Old booking row: mark as "rescheduled", keep original slotStart/slotEnd unchanged
    //   so it no longer conflicts with slot checks (pending/confirmed only).
    // - New booking row: created with new slot at pending/confirmed status.
    // This ensures the new slot is tracked as an active booking in conflict checks.
    let newBooking: typeof bookingsTable.$inferSelect | undefined;
    let lockConflict = false;

    await db.transaction(async (tx) => {
      const lockResult = await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS acquired`
      );
      const acquired = (lockResult.rows[0] as any)?.acquired === true;
      if (!acquired) { lockConflict = true; return; }

      // Buffer-aware in-transaction conflict check for reschedule (same logic as create)
      const newBufBefore = addMinutes(newSlotStart, -(eventType?.bufferBeforeMins ?? 0));
      const newBufAfter = addMinutes(newSlotEnd, eventType?.bufferAfterMins ?? 0);

      const reschedOverlapCount = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(bookingsTable)
        .where(
          and(
            eq(bookingsTable.calendarId, existing.calendarId),
            or(eq(bookingsTable.status, "pending"), eq(bookingsTable.status, "confirmed")),
            sql`${bookingsTable.slotStart} < ${newBufAfter}`,
            sql`${bookingsTable.slotEnd} > ${newBufBefore}`,
          ),
        )
        .then((r) => r[0]?.count ?? 0);

      const reschedExactCount = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(bookingsTable)
        .where(
          and(
            eq(bookingsTable.calendarId, existing.calendarId),
            or(eq(bookingsTable.status, "pending"), eq(bookingsTable.status, "confirmed")),
            sql`${bookingsTable.slotStart} < ${newSlotEnd}`,
            sql`${bookingsTable.slotEnd} > ${newSlotStart}`,
          ),
        )
        .then((r) => r[0]?.count ?? 0);

      const maxCap = eventType?.maxBookingsPerSlot ?? 1;
      if (reschedExactCount >= maxCap || reschedOverlapCount > reschedExactCount) {
        lockConflict = true; return;
      }

      // Mark old booking as rescheduled (original timestamps preserved)
      await tx.update(bookingsTable)
        .set({ status: "rescheduled", updatedAt: new Date() })
        .where(eq(bookingsTable.id, params.data.id));

      // Insert new active booking for the new slot
      const [inserted] = await tx.insert(bookingsTable).values({
        eventTypeId: existing.eventTypeId,
        calendarId: existing.calendarId,
        callId: existing.callId,
        userId: existing.userId,
        attendeeName: existing.attendeeName,
        attendeeEmail: existing.attendeeEmail,
        attendeeNotes: existing.attendeeNotes,
        slotStart: newSlotStart,
        slotEnd: newSlotEnd,
        status: eventType?.confirmationMode === "instant" ? "confirmed" : "pending",
        bookedVia: existing.bookedVia,
        rescheduledFromId: existing.id,
      }).returning();
      newBooking = inserted;
    });

    if (lockConflict || !newBooking) {
      res.status(409).json({ error: "New slot already booked — please choose another" });
      return;
    }

    void sendBookingRescheduledEmail({
      attendeeName: newBooking.attendeeName,
      attendeeEmail: newBooking.attendeeEmail,
      eventTypeName: eventType?.name ?? "",
      slotStart: newBooking.slotStart,
      slotEnd: newBooking.slotEnd,
      timezone: calendar?.timezone ?? "UTC",
      bookingId: newBooking.id,
      oldSlotStart: existing.slotStart,
    });
    void dispatchSchedulingWebhooks(clerkId, "scheduling.booking.rescheduled", { booking: formatBooking(newBooking) });
    res.json(UpdateBookingResponse.parse(formatBooking(newBooking)));
    return;
  }

  const updates: Partial<typeof bookingsTable.$inferInsert> = { updatedAt: new Date() };
  let webhookEvent: "scheduling.booking.cancelled" | "scheduling.booking.confirmed" | undefined;

  if (parsed.data.status === "cancelled") {
    updates.status = "cancelled";
    updates.cancelledAt = new Date();
    webhookEvent = "scheduling.booking.cancelled";
  } else if (parsed.data.status === "confirmed") {
    updates.status = "confirmed";
    webhookEvent = "scheduling.booking.confirmed";
  }

  const [row] = await db.update(bookingsTable)
    .set(updates)
    .where(and(eq(bookingsTable.id, params.data.id), eq(bookingsTable.userId, clerkId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Booking not found" }); return; }

  if (webhookEvent === "scheduling.booking.cancelled") {
    void sendBookingCancelledEmail({
      attendeeName: row.attendeeName,
      attendeeEmail: row.attendeeEmail,
      eventTypeName: eventType?.name ?? "",
      slotStart: row.slotStart,
      slotEnd: row.slotEnd,
      timezone: calendar?.timezone ?? "UTC",
      bookingId: row.id,
    });
  } else if (webhookEvent === "scheduling.booking.confirmed") {
    void sendBookingConfirmedEmail({
      attendeeName: row.attendeeName,
      attendeeEmail: row.attendeeEmail,
      eventTypeName: eventType?.name ?? "",
      slotStart: row.slotStart,
      slotEnd: row.slotEnd,
      timezone: calendar?.timezone ?? "UTC",
      bookingId: row.id,
    });
  }

  if (webhookEvent) {
    void dispatchSchedulingWebhooks(clerkId, webhookEvent, { booking: formatBooking(row) });
  }

  res.json(UpdateBookingResponse.parse(formatBooking(row)));
});

export default router;

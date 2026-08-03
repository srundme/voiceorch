import { Router, type IRouter } from "express";
import { addMinutes } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { eq, and, or, sql } from "drizzle-orm";
import { db, eventTypesTable, schedulingCalendarsTable, bookingsTable } from "@workspace/db";
import { getAvailableSlots } from "../../services/scheduling/slot-engine.js";
import {
  sendBookingCreatedEmail,
  sendBookingCancelledEmail,
  sendBookingRescheduledEmail,
} from "../../services/scheduling/notifications.js";
import { dispatchSchedulingWebhooks } from "./webhooks.js";
import {
  GetPublicEventTypeParams,
  GetPublicSlotsResponse,
  GetPublicEventTypeResponse,
  CreatePublicBookingBody,
  GetBookingResponse,
  GetPublicBookingByTokenQueryParams,
  GetPublicBookingByTokenResponse,
  CancelPublicBookingByTokenBody,
  CancelPublicBookingByTokenResponse,
  ReschedulePublicBookingByTokenBody,
  ReschedulePublicBookingByTokenResponse,
} from "@workspace/api-zod";
import { buildSlotLockKey } from "../../services/scheduling/lock.js";
import { logger } from "../../lib/logger.js";
import { schedulingSlotsRateLimit, schedulingBookingRateLimit } from "../../lib/rate-limit.js";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
  getFirstConnectionForUser,
} from "../../services/scheduling/google-calendar.js";
import {
  issueToken,
  verifyToken,
  cancelTokenExpiry,
  rescheduleTokenExpiry,
} from "../../services/scheduling/booking-tokens.js";

const router: IRouter = Router();

import { getSelfBaseUrl } from "../../lib/app-domain.js";

function getBaseUrl(): string {
  if (process.env["APP_BASE_URL"]) return process.env["APP_BASE_URL"];
  return getSelfBaseUrl();
}

function formatBooking(b: typeof bookingsTable.$inferSelect) {
  return {
    ...b,
    slotStart: b.slotStart.toISOString(),
    slotEnd: b.slotEnd.toISOString(),
    cancelledAt: b.cancelledAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
    meetLink: (b as any).meetLink ?? null,
    googleEventId: (b as any).googleEventId ?? null,
  };
}

router.get("/scheduling/public/now", (_req, res): void => {
  res.json({ now: new Date().toISOString() });
});

router.get("/scheduling/public/event-types/:slug", async (req, res): Promise<void> => {
  const params = GetPublicEventTypeParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Validation failed", issues: params.error.issues }); return; }

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

router.get("/scheduling/public/slots", schedulingSlotsRateLimit, async (req, res): Promise<void> => {
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

router.post("/scheduling/public/bookings", schedulingBookingRateLimit, async (req, res): Promise<void> => {
  const parsed = CreatePublicBookingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const [eventType] = await db.select().from(eventTypesTable)
    .where(eq(eventTypesTable.slug, parsed.data.eventTypeSlug));
  if (!eventType || !eventType.isActive) { res.status(404).json({ error: "Event type not found" }); return; }

  const [calendar] = await db.select().from(schedulingCalendarsTable)
    .where(eq(schedulingCalendarsTable.id, eventType.calendarId));
  if (!calendar || !calendar.isActive) { res.status(404).json({ error: "Calendar not available" }); return; }

  const slotStart = new Date(parsed.data.slotStart);

  // Reject slots whose start time is already in the past
  if (slotStart.getTime() <= Date.now()) {
    res.status(409).json({ error: "This slot is in the past — please choose a future time" });
    return;
  }

  const slotEnd = addMinutes(slotStart, eventType.durationMinutes);
  const lockKey = buildSlotLockKey(calendar.id, slotStart);

  let booking: typeof bookingsTable.$inferSelect | undefined;
  let lockConflict = false;

  // Validate the requested slot against computed availability windows.
  // Use formatInTimeZone so that a slot like "2026-06-22T14:00:00+05:30" resolves
  // to "2026-06-22" in IST — not the UTC-local date ("2026-06-22T08:30:00Z" → same
  // day here, but near-midnight IST slots would cross to the wrong day without this).
  const slotTz = calendar.timezone || "UTC";
  const availableSlots = await getAvailableSlots(
    eventType.id,
    formatInTimeZone(slotStart, slotTz, "yyyy-MM-dd"),
    formatInTimeZone(slotStart, slotTz, "yyyy-MM-dd"),
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

  // Create Google Calendar event with Meet link
  let meetLink: string | null = null;
  let googleEventId: string | null = null;
  let gcalConnectionId: string | null = null;
  let gcalFailed = false;
  let calendarSyncStatus: string | null = null;
  let calendarSyncError: string | null = null;

  if (!eventType.enableGoogleMeet) {
    // Google Meet not enabled on this event type — skip GCal entirely
    calendarSyncStatus = "skipped";
    await db.execute(
      sql`UPDATE bookings SET calendar_sync_status = 'skipped' WHERE id = ${booking.id}`
    );
  } else {
  try {
    const calRow = await db.execute(
      sql`SELECT google_calendar_connection_id FROM scheduling_calendars WHERE id = ${calendar.id}`
    );
    const calendarConnectionId = (calRow.rows[0] as any)?.google_calendar_connection_id as string | null;
    gcalConnectionId = calendarConnectionId ?? (await getFirstConnectionForUser(calendar.userId))?.id ?? null;

    if (!gcalConnectionId) {
      calendarSyncStatus = "skipped";
      await db.execute(
        sql`UPDATE bookings SET calendar_sync_status = 'skipped' WHERE id = ${booking.id}`
      );
      logger.warn(
        { calendarId: calendar.id, calendarConnectionId, bookingId: booking.id },
        "No Google connection found — skipping calendar event",
      );
    } else {
      logger.info(
        { calendarId: calendar.id, calendarConnectionId, connectionId: gcalConnectionId, bookingId: booking.id },
        "Attempting Google Calendar event creation",
      );
    }

    let gcalErrCode: string | null = null;
    let gcalErrMsg: string | null = null;
    const gcalResult = gcalConnectionId ? await createCalendarEvent({
      connectionId: gcalConnectionId,
      summary: `${eventType.name} — ${booking.attendeeName}`,
      description: booking.attendeeNotes ?? undefined,
      startTime: booking.slotStart,
      endTime: booking.slotEnd,
      attendeeEmail: booking.attendeeEmail,
      attendeeName: booking.attendeeName,
      timezone: calendar.timezone,
      hostEmail: calendar.hostEmail,
      additionalHosts: calendar.additionalHosts,
      onError: (detail) => { gcalErrCode = detail.errorCode; gcalErrMsg = detail.message ?? null; },
    }) : null;
    if (gcalConnectionId && !gcalResult) {
      gcalFailed = true;
      calendarSyncStatus = gcalErrCode === "scope_insufficient" ? "scope_insufficient" : "sync_failed";
      calendarSyncError = gcalErrMsg;
      await db.execute(
        sql`UPDATE bookings SET calendar_sync_status = ${calendarSyncStatus}, calendar_sync_error = ${calendarSyncError} WHERE id = ${booking.id}`
      );
      logger.error(
        { connectionId: gcalConnectionId, bookingId: booking.id, gcalErrCode, gcalErrMsg, calendarSyncStatus },
        "createCalendarEvent returned null — Google Calendar event not created; booking will be downgraded to pending",
      );
    }
    if (gcalResult) {
      meetLink = gcalResult.meetLink;
      googleEventId = gcalResult.eventId;
      calendarSyncStatus = "synced";
      await db.execute(
        sql`UPDATE bookings SET meet_link = ${meetLink}, google_event_id = ${googleEventId}, calendar_sync_status = 'synced' WHERE id = ${booking.id}`
      );
    }
  } catch (err) {
    if (gcalConnectionId) {
      gcalFailed = true;
      calendarSyncStatus = "sync_failed";
      calendarSyncError = String((err as any)?.message ?? err);
      await db.execute(
        sql`UPDATE bookings SET calendar_sync_status = 'sync_failed', calendar_sync_error = ${calendarSyncError} WHERE id = ${booking.id}`
      ).catch(() => {});
    }
    logger.error(
      { err, errStack: (err as any)?.stack, googleApiError: (err as any)?.response?.data, errDetails: (err as any)?.errors, bookingId: booking.id, connectionId: gcalConnectionId },
      "Google Calendar event creation failed",
    );
  }
  } // end if (eventType.enableGoogleMeet)

  // Only downgrade to pending on GCal failure for manual-confirmation event types.
  // Instant (auto-confirm) events stay confirmed — GCal is supplementary.
  if (gcalFailed && eventType.confirmationMode !== "instant" && booking.status === "confirmed") {
    await db.execute(sql`UPDATE bookings SET status = 'pending' WHERE id = ${booking.id}`);
    booking = { ...booking, status: "pending" };
    logger.warn({ bookingId: booking.id, connectionId: gcalConnectionId }, "Booking downgraded to pending — Google Calendar event creation failed (manual-confirm event)");
  }

  // Issue self-service tokens for this booking
  const baseUrl = getBaseUrl();
  const cancelTok = issueToken(booking.id, "cancel", cancelTokenExpiry());
  const rescheduleTok = issueToken(booking.id, "reschedule", rescheduleTokenExpiry(booking.slotStart));
  const cancelLink = `${baseUrl}/book/cancel?token=${encodeURIComponent(cancelTok)}`;
  const rescheduleLink = `${baseUrl}/book/reschedule?token=${encodeURIComponent(rescheduleTok)}`;

  // Send confirmation email for confirmed bookings (instant-confirm sends even if GCal failed)
  if (!gcalFailed || eventType.confirmationMode === "instant") {
    void sendBookingCreatedEmail({
      attendeeName: booking.attendeeName,
      attendeeEmail: booking.attendeeEmail,
      eventTypeName: eventType.name,
      slotStart: booking.slotStart,
      slotEnd: booking.slotEnd,
      timezone: calendar.timezone,
      hostEmail: calendar.hostEmail,
      additionalHosts: calendar.additionalHosts,
      bookingId: booking.id,
      notes: booking.attendeeNotes,
      meetLink,
      cancelLink,
      rescheduleLink,
      calendarSyncStatus,
    });
  }
  void dispatchSchedulingWebhooks(calendar.userId, "scheduling.booking.created", {
    booking: {
      ...booking,
      slotStart: booking.slotStart.toISOString(),
      slotEnd: booking.slotEnd.toISOString(),
      cancelledAt: booking.cancelledAt?.toISOString() ?? null,
      createdAt: booking.createdAt.toISOString(),
      updatedAt: booking.updatedAt.toISOString(),
      meetLink,
      googleEventId,
    },
  });

  res.status(201).json(GetBookingResponse.parse({
    ...booking,
    slotStart: booking.slotStart.toISOString(),
    slotEnd: booking.slotEnd.toISOString(),
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString(),
    meetLink,
    googleEventId,
  }));
});

// ── Token-gated self-service routes ──────────────────────────────────────────

router.get("/scheduling/public/bookings/by-token", async (req, res): Promise<void> => {
  const qp = GetPublicBookingByTokenQueryParams.safeParse(req.query);
  if (!qp.success) { res.status(400).json({ error: "token is required" }); return; }

  const verified = verifyToken(qp.data.token);
  if (!verified) { res.status(400).json({ error: "Invalid or expired token" }); return; }

  const [booking] = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.id, verified.bookingId));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  const [eventType] = booking.eventTypeId != null
    ? await db.select().from(eventTypesTable).where(eq(eventTypesTable.id, booking.eventTypeId))
    : [];
  const [calendar] = booking.calendarId != null
    ? await db.select().from(schedulingCalendarsTable).where(eq(schedulingCalendarsTable.id, booking.calendarId))
    : [];

  const meetLinkRow = await db.execute(
    sql`SELECT meet_link FROM bookings WHERE id = ${booking.id}`
  );
  const meetLink = (meetLinkRow.rows[0] as any)?.meet_link as string | null ?? null;

  res.json(GetPublicBookingByTokenResponse.parse({
    bookingId: booking.id,
    attendeeName: booking.attendeeName,
    attendeeEmail: booking.attendeeEmail,
    eventTypeName: eventType?.name ?? "",
    eventTypeSlug: eventType?.slug ?? "",
    slotStart: booking.slotStart.toISOString(),
    slotEnd: booking.slotEnd.toISOString(),
    timezone: calendar?.timezone ?? "UTC",
    status: booking.status,
    action: verified.action,
    meetLink,
  }));
});

router.post("/scheduling/public/bookings/cancel", async (req, res): Promise<void> => {
  const parsed = CancelPublicBookingByTokenBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const verified = verifyToken(parsed.data.token);
  if (!verified || verified.action !== "cancel") {
    res.status(400).json({ error: "Invalid or expired cancellation token" }); return;
  }

  const [booking] = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.id, verified.bookingId));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  if (booking.status === "cancelled" || booking.status === "rescheduled") {
    res.status(409).json({ error: "This booking has already been cancelled or rescheduled" }); return;
  }

  const [eventType] = booking.eventTypeId != null
    ? await db.select().from(eventTypesTable).where(eq(eventTypesTable.id, booking.eventTypeId))
    : [];
  const [calendar] = booking.calendarId != null
    ? await db.select().from(schedulingCalendarsTable).where(eq(schedulingCalendarsTable.id, booking.calendarId))
    : [];

  // Fetch google_event_id (not in Drizzle schema type)
  const gcalRow = await db.execute(
    sql`SELECT google_event_id FROM bookings WHERE id = ${booking.id}`
  );
  const existingGoogleEventId = (gcalRow.rows[0] as any)?.google_event_id as string | null ?? null;

  const [cancelled] = await db.update(bookingsTable)
    .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(bookingsTable.id, booking.id))
    .returning();

  if (!cancelled) { res.status(404).json({ error: "Booking not found" }); return; }

  // Delete Google Calendar event (best-effort, fire-and-forget)
  if (existingGoogleEventId) {
    void (async () => {
      try {
        const calRow = await db.execute(
          sql`SELECT google_calendar_connection_id FROM scheduling_calendars WHERE id = ${booking.calendarId}`
        );
        const calendarConnectionId = (calRow.rows[0] as any)?.google_calendar_connection_id as string | null;
        const connectionId = calendarConnectionId ?? (await getFirstConnectionForUser(booking.userId))?.id ?? null;
        if (connectionId) {
          await deleteCalendarEvent(connectionId, existingGoogleEventId);
        }
      } catch { /* non-fatal */ }
    })();
  }

  void sendBookingCancelledEmail({
    attendeeName: cancelled.attendeeName,
    attendeeEmail: cancelled.attendeeEmail,
    eventTypeName: eventType?.name ?? "",
    slotStart: cancelled.slotStart,
    slotEnd: cancelled.slotEnd,
    timezone: calendar?.timezone ?? "UTC",
    hostEmail: calendar?.hostEmail,
    additionalHosts: calendar?.additionalHosts,
    bookingId: cancelled.id,
  });

  void dispatchSchedulingWebhooks(booking.userId, "scheduling.booking.cancelled", {
    booking: formatBooking(cancelled),
  });

  res.json(CancelPublicBookingByTokenResponse.parse(formatBooking(cancelled)));
});

router.post("/scheduling/public/bookings/reschedule", async (req, res): Promise<void> => {
  const parsed = ReschedulePublicBookingByTokenBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const verified = verifyToken(parsed.data.token);
  if (!verified || verified.action !== "reschedule") {
    res.status(400).json({ error: "Invalid or expired reschedule token" }); return;
  }

  const [booking] = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.id, verified.bookingId));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  if (booking.status === "cancelled" || booking.status === "rescheduled") {
    res.status(409).json({ error: "This booking is no longer active and cannot be rescheduled" }); return;
  }

  // Also reject if the slot has already started (belt-and-suspenders — token expiry already handles this)
  if (booking.slotStart <= new Date()) {
    res.status(400).json({ error: "This appointment has already started and cannot be rescheduled" }); return;
  }

  const [eventType] = booking.eventTypeId != null
    ? await db.select().from(eventTypesTable).where(eq(eventTypesTable.id, booking.eventTypeId))
    : [];
  const [calendar] = booking.calendarId != null
    ? await db.select().from(schedulingCalendarsTable).where(eq(schedulingCalendarsTable.id, booking.calendarId))
    : [];

  if (!eventType || !calendar) { res.status(404).json({ error: "Event type or calendar not found" }); return; }
  if (booking.eventTypeId == null || booking.calendarId == null) { res.status(422).json({ error: "This booking's event type or calendar has been deleted" }); return; }

  const newSlotStart = new Date(parsed.data.slotStart);
  const newSlotEnd = addMinutes(newSlotStart, eventType.durationMinutes);
  const lockKey = buildSlotLockKey(booking.calendarId, newSlotStart);

  // Validate new slot against availability (timezone-safe date boundary).
  const reschedTz = calendar.timezone || "UTC";
  const availableSlots = await getAvailableSlots(
    booking.eventTypeId,
    formatInTimeZone(newSlotStart, reschedTz, "yyyy-MM-dd"),
    formatInTimeZone(newSlotStart, reschedTz, "yyyy-MM-dd"),
  );
  const slotIsAvailable = availableSlots.some(
    (s) => s.slotStart.getTime() === newSlotStart.getTime(),
  );
  if (!slotIsAvailable) {
    res.status(409).json({ error: "This slot is not available — please choose another" }); return;
  }

  // Fetch existing google_event_id
  const gcalRow = await db.execute(
    sql`SELECT google_event_id FROM bookings WHERE id = ${booking.id}`
  );
  const existingGoogleEventId = (gcalRow.rows[0] as any)?.google_event_id as string | null ?? null;

  let newBooking: typeof bookingsTable.$inferSelect | undefined;
  let lockConflict = false;

  await db.transaction(async (tx) => {
    const lockResult = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS acquired`
    );
    const acquired = (lockResult.rows[0] as any)?.acquired === true;
    if (!acquired) { lockConflict = true; return; }

    const newBufBefore = addMinutes(newSlotStart, -eventType.bufferBeforeMins);
    const newBufAfter = addMinutes(newSlotEnd, eventType.bufferAfterMins);

    const overlapCount = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(bookingsTable)
      .where(
        and(
          sql`${bookingsTable.calendarId} = ${booking.calendarId}`,
          or(eq(bookingsTable.status, "pending"), eq(bookingsTable.status, "confirmed")),
          sql`${bookingsTable.slotStart} < ${newBufAfter}`,
          sql`${bookingsTable.slotEnd} > ${newBufBefore}`,
        ),
      )
      .then((r) => r[0]?.count ?? 0);

    const exactOverlapCount = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(bookingsTable)
      .where(
        and(
          sql`${bookingsTable.calendarId} = ${booking.calendarId}`,
          or(eq(bookingsTable.status, "pending"), eq(bookingsTable.status, "confirmed")),
          sql`${bookingsTable.slotStart} < ${newSlotEnd}`,
          sql`${bookingsTable.slotEnd} > ${newSlotStart}`,
        ),
      )
      .then((r) => r[0]?.count ?? 0);

    if (exactOverlapCount >= eventType.maxBookingsPerSlot || overlapCount > exactOverlapCount) {
      lockConflict = true; return;
    }

    // Mark old booking as rescheduled — only if it is still active.
    // This is the atomic single-use guard: concurrent requests that reuse the
    // same reschedule token but target different slots each acquire a different
    // slot-specific advisory lock, so they do NOT contend with each other via
    // the lock above. Making the UPDATE conditional on the current status and
    // checking the affected row count ensures exactly one reschedule wins,
    // regardless of how many parallel requests reach this point simultaneously.
    const markedRescheduled = await tx.update(bookingsTable)
      .set({ status: "rescheduled", updatedAt: new Date() })
      .where(
        and(
          eq(bookingsTable.id, booking.id),
          or(eq(bookingsTable.status, "pending"), eq(bookingsTable.status, "confirmed")),
        ),
      )
      .returning({ id: bookingsTable.id });

    if (markedRescheduled.length === 0) {
      // Another concurrent request already consumed this reschedule token.
      lockConflict = true; return;
    }

    // Create new booking for the new slot
    const [inserted] = await tx.insert(bookingsTable).values({
      eventTypeId: booking.eventTypeId,
      calendarId: booking.calendarId,
      callId: booking.callId,
      userId: booking.userId,
      attendeeName: booking.attendeeName,
      attendeeEmail: booking.attendeeEmail,
      attendeeNotes: booking.attendeeNotes,
      slotStart: newSlotStart,
      slotEnd: newSlotEnd,
      status: eventType.confirmationMode === "instant" ? "confirmed" : "pending",
      bookedVia: booking.bookedVia,
      rescheduledFromId: booking.id,
    }).returning();
    newBooking = inserted;
  });

  if (lockConflict || !newBooking) {
    res.status(409).json({ error: "This slot is no longer available — please choose another" }); return;
  }

  // Google Calendar sync (best-effort) — awaited so the resulting Meet link is
  // available for the reschedule confirmation email.
  let rescheduledMeetLink: string | null = booking.meetLink ?? null;
  {
    let reschedConnectionId: string | null = null;
    try {
      const calRow = await db.execute(
        sql`SELECT google_calendar_connection_id FROM scheduling_calendars WHERE id = ${booking.calendarId}`
      );
      const calendarConnectionId = (calRow.rows[0] as any)?.google_calendar_connection_id as string | null;
      reschedConnectionId = calendarConnectionId ?? (await getFirstConnectionForUser(booking.userId))?.id ?? null;

      if (!reschedConnectionId) {
        logger.warn(
          { calendarId: booking.calendarId, calendarConnectionId, bookingId: newBooking?.id },
          "No Google connection found — skipping calendar event on reschedule",
        );
      }

      if (reschedConnectionId && newBooking) {
        if (existingGoogleEventId) {
          // Patch the existing event — attendee calendar updates automatically
          logger.info(
            { bookingId: booking.id, newBookingId: newBooking.id, existingGoogleEventId,
              connectionId: reschedConnectionId, newSlotStart: newBooking.slotStart, newSlotEnd: newBooking.slotEnd },
            "Public reschedule: patching existing Google Calendar event",
          );
          const gcalResult = await updateCalendarEvent({
            connectionId: reschedConnectionId,
            eventId: existingGoogleEventId,
            summary: `${eventType.name} — ${newBooking.attendeeName}`,
            description: newBooking.attendeeNotes ?? undefined,
            startTime: newBooking.slotStart,
            endTime: newBooking.slotEnd,
            attendeeEmail: newBooking.attendeeEmail,
            attendeeName: newBooking.attendeeName,
            timezone: calendar.timezone,
            hostEmail: calendar.hostEmail,
            additionalHosts: calendar.additionalHosts,
          });
          if (gcalResult) {
            await db.execute(
              sql`UPDATE bookings SET meet_link = ${gcalResult.meetLink}, google_event_id = ${gcalResult.eventId} WHERE id = ${newBooking.id}`
            );
            rescheduledMeetLink = gcalResult.meetLink ?? rescheduledMeetLink;
          }
        } else {
          // No existing event — create fresh
          logger.info(
            { bookingId: booking.id, newBookingId: newBooking.id, existingGoogleEventId: null,
              connectionId: reschedConnectionId, newSlotStart: newBooking.slotStart, newSlotEnd: newBooking.slotEnd },
            "Public reschedule: no existing Google event — creating fresh",
          );
          const gcalResult = await createCalendarEvent({
            connectionId: reschedConnectionId,
            summary: `${eventType.name} — ${newBooking.attendeeName}`,
            description: newBooking.attendeeNotes ?? undefined,
            startTime: newBooking.slotStart,
            endTime: newBooking.slotEnd,
            attendeeEmail: newBooking.attendeeEmail,
            attendeeName: newBooking.attendeeName,
            timezone: calendar.timezone,
            hostEmail: calendar.hostEmail,
            additionalHosts: calendar.additionalHosts,
          });
          if (gcalResult) {
            await db.execute(
              sql`UPDATE bookings SET meet_link = ${gcalResult.meetLink}, google_event_id = ${gcalResult.eventId} WHERE id = ${newBooking.id}`
            );
            rescheduledMeetLink = gcalResult.meetLink ?? null;
          }
        }
      }
    } catch (err) {
      logger.warn(
        { err: (err as any)?.message, googleApiError: (err as any)?.response?.data,
          bookingId: newBooking?.id, connectionId: reschedConnectionId },
        "Google Calendar event creation failed on reschedule",
      );
    }
  }

  // Issue new reschedule token for the new booking
  const baseUrl = getBaseUrl();
  const newCancelTok = issueToken(newBooking.id, "cancel", cancelTokenExpiry());
  const newRescheduleTok = issueToken(newBooking.id, "reschedule", rescheduleTokenExpiry(newBooking.slotStart));
  const newCancelLink = `${baseUrl}/book/cancel?token=${encodeURIComponent(newCancelTok)}`;
  const newRescheduleLink = `${baseUrl}/book/reschedule?token=${encodeURIComponent(newRescheduleTok)}`;

  void sendBookingRescheduledEmail({
    attendeeName: newBooking.attendeeName,
    attendeeEmail: newBooking.attendeeEmail,
    eventTypeName: eventType.name,
    slotStart: newBooking.slotStart,
    slotEnd: newBooking.slotEnd,
    timezone: calendar.timezone,
    hostEmail: calendar.hostEmail,
    additionalHosts: calendar.additionalHosts,
    bookingId: newBooking.id,
    oldSlotStart: booking.slotStart,
    meetLink: rescheduledMeetLink,
    cancelLink: newCancelLink,
    rescheduleLink: newRescheduleLink,
  });

  void dispatchSchedulingWebhooks(booking.userId, "scheduling.booking.rescheduled", {
    booking: formatBooking(newBooking),
  });

  res.json(ReschedulePublicBookingByTokenResponse.parse(formatBooking(newBooking)));
});

export default router;

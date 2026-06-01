import { format, addMinutes } from "date-fns";
import { toZonedTime, formatInTimeZone } from "date-fns-tz";
import {
  db,
  bookingsTable,
  eventTypesTable,
  schedulingCalendarsTable,
  agentsTable,
} from "@workspace/db";
import { eq, and, or, sql } from "drizzle-orm";
import { getAvailableSlots } from "./scheduling/slot-engine.js";
import { buildSlotLockKey } from "./scheduling/lock.js";
import {
  sendBookingCreatedEmail,
  sendBookingCancelledEmail,
  sendBookingRescheduledEmail,
} from "./scheduling/notifications.js";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  getFirstConnectionForUser,
} from "./scheduling/google-calendar.js";
import { dispatchSchedulingWebhooks } from "../routes/scheduling/webhooks.js";
import type { AgentTool, ToolDefinition } from "../orchestration/types.js";
import { logger } from "../lib/logger.js";
import type { TimeSlot } from "./scheduling/slot-engine.js";

// ── Tool definitions builder ──────────────────────────────────────────────────

/**
 * Build the ToolDefinition array from an agent's tools array.
 * Always injects a built-in `end_call` tool unless the agent already defines one.
 * Suitable for passing directly to LLM adapters.
 */
export function buildToolDefs(tools: AgentTool[]): ToolDefinition[] {
  const hasExplicitEndCall = tools.some((t) => t.type === "end_call");
  const builtInEndCall: ToolDefinition[] = hasExplicitEndCall
    ? []
    : [
        {
          name: "end_call",
          description:
            "End the phone call. Call this when the conversation is complete, the caller says goodbye, all objectives are met, or the caller requests to end the call.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      ];

  return [
    ...builtInEndCall,
    ...tools.map((t): ToolDefinition => {
      if (t.type === "native_booking") {
        return {
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: {
              attendee_name: { type: "string", description: "Full name of the person being booked" },
              attendee_email: { type: "string", description: "Email address of the person being booked" },
              preferred_date: {
                type: "string",
                description:
                  "Optional preferred date or time of day for the appointment, e.g. 'next Tuesday', '2025-06-10', 'morning', or 'afternoon'. The system will find the first available slot on or after this date/time.",
              },
            },
            required: ["attendee_name", "attendee_email"],
          },
        };
      }
      if (t.type === "native_reschedule") {
        return {
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: {
              booking_id: { type: "string", description: "The booking reference ID to reschedule" },
              preferred_date: {
                type: "string",
                description: "Optional preferred date/time for the new slot, e.g. 'next Tuesday' or '2025-06-10T14:00'",
              },
            },
            required: ["booking_id"],
          },
        };
      }
      if (t.type === "native_cancel") {
        return {
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: {
              booking_id: { type: "string", description: "The booking reference ID to cancel" },
            },
            required: ["booking_id"],
          },
        };
      }
      if (t.type === "native_check_availability") {
        return {
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: {
              preferred_date: {
                type: "string",
                description:
                  "Optional preferred date or time of day to check availability for, e.g. 'next Tuesday', '2025-06-10', 'tomorrow morning'. Defaults to the next 7 days.",
              },
            },
            required: [],
          },
        };
      }
      // Generic fallback for call_transfer, webhook, send_sms, end_call, cal_com
      return {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object",
          properties: {
            reason: { type: "string", description: "Brief reason for invoking this tool" },
          },
          required: [],
        },
      };
    }),
  ];
}

// ── Native scheduling executors ───────────────────────────────────────────────

export async function executeNativeBooking(
  callId: number,
  agentId: number,
  tool: AgentTool & { type: "native_booking" },
  args: Record<string, unknown>,
): Promise<string> {
  logger.info({ callId, eventTypeId: tool.eventTypeId }, "Native booking tool invoked");
  const attendeeName = String(args["attendee_name"] ?? args["name"] ?? "Guest");
  const attendeeEmail = String(args["attendee_email"] ?? args["email"] ?? "");
  const preferredRaw = args["preferred_date"] != null ? String(args["preferred_date"]) : null;

  if (!attendeeEmail) {
    logger.warn({ callId }, "Native booking: no attendee email — cannot book");
    return "error: attendee_email is required to complete the booking";
  }

  try {
    const [agentCalendar] = await db
      .select({ userId: schedulingCalendarsTable.userId })
      .from(schedulingCalendarsTable)
      .where(eq(schedulingCalendarsTable.agentId, agentId));
    let authorizedUserId: string | null = null;
    if (agentCalendar) {
      authorizedUserId = agentCalendar.userId;
    } else {
      const [agentRow] = await db
        .select({ userId: agentsTable.userId })
        .from(agentsTable)
        .where(eq(agentsTable.id, agentId));
      authorizedUserId = agentRow?.userId ?? null;
    }

    const [eventType] = await db.select().from(eventTypesTable).where(eq(eventTypesTable.id, tool.eventTypeId));
    if (!eventType || !eventType.isActive) {
      return "error: the appointment type is unavailable";
    }

    const [calendar] = await db
      .select()
      .from(schedulingCalendarsTable)
      .where(eq(schedulingCalendarsTable.id, eventType.calendarId));
    if (!calendar || !calendar.isActive) {
      return "error: the calendar is unavailable";
    }

    if (authorizedUserId && calendar.userId !== authorizedUserId) {
      logger.warn(
        { callId, eventTypeId: tool.eventTypeId, authorizedUserId, calendarUserId: calendar.userId },
        "Native booking: event type ownership mismatch — rejected",
      );
      return "error: the appointment type is unavailable";
    }

    const { searchStart, minSlotStart, timeFilter } = preferredRaw
      ? parsePreferredDate(preferredRaw, calendar.timezone)
      : { searchStart: new Date(), minSlotStart: undefined, timeFilter: undefined };
    if (preferredRaw) {
      logger.info({ callId, preferredRaw, searchStart, minSlotStart }, "Native booking: preferred date resolved");
    }
    const searchEnd = new Date(searchStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    let slots = await getAvailableSlots(tool.eventTypeId, format(searchStart, "yyyy-MM-dd"), format(searchEnd, "yyyy-MM-dd"));
    if (minSlotStart) slots = slots.filter((s) => s.slotStart >= minSlotStart);
    if (timeFilter) slots = slots.filter(timeFilter);
    if (slots.length === 0) {
      const rangeDesc = preferredRaw ? `on or after "${preferredRaw}"` : "in the next 7 days";
      logger.info({ callId, eventTypeId: tool.eventTypeId }, `Native booking: no available slots ${rangeDesc}`);
      return `error: no available slots ${rangeDesc}`;
    }

    const slot = slots[0]!;
    const slotStart = slot.slotStart;
    const slotEnd = slot.slotEnd;
    const lockKey = buildSlotLockKey(calendar.id, slotStart);

    let booking: typeof bookingsTable.$inferSelect | undefined;
    let lockConflict = false;

    await db.transaction(async (tx) => {
      const lockResult = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS acquired`);
      const acquired = (lockResult.rows[0] as { acquired?: boolean })?.acquired === true;
      if (!acquired) {
        lockConflict = true;
        return;
      }

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

      if (exactOverlapCount >= eventType.maxBookingsPerSlot || overlapCount > exactOverlapCount) {
        lockConflict = true;
        return;
      }

      const [inserted] = await tx
        .insert(bookingsTable)
        .values({
          eventTypeId: eventType.id,
          calendarId: calendar.id,
          callId,
          userId: calendar.userId,
          attendeeName,
          attendeeEmail,
          attendeeNotes: null,
          slotStart,
          slotEnd,
          status: eventType.confirmationMode === "instant" ? "confirmed" : "pending",
          bookedVia: "agent",
        })
        .returning();
      booking = inserted;
    });

    if (lockConflict || !booking) {
      logger.warn({ callId }, "Native booking: slot conflict");
      return "error: slot was just taken — no booking created";
    }

    const dateStr = format(slotStart, "EEEE, MMMM do 'at' h:mm a");
    logger.info({ callId, bookingId: booking.id, slotStart, attendeeEmail }, "Native booking created");

    // Create Google Calendar event with Meet link (best-effort, non-blocking)
    let meetLink: string | null = null;
    let googleEventId: string | null = null;
    try {
      const calRow = await db.execute(
        sql`SELECT google_calendar_connection_id FROM scheduling_calendars WHERE id = ${calendar.id}`,
      );
      const calendarConnectionId = (calRow.rows[0] as { google_calendar_connection_id?: string | null })
        ?.google_calendar_connection_id ?? null;
      const connectionId = calendarConnectionId ?? (await getFirstConnectionForUser(calendar.userId))?.id ?? null;

      const gcalResult = connectionId
        ? await createCalendarEvent({
            connectionId,
            summary: `${eventType.name} — ${booking.attendeeName}`,
            description: booking.attendeeNotes ?? undefined,
            startTime: booking.slotStart,
            endTime: booking.slotEnd,
            attendeeEmail: booking.attendeeEmail,
            attendeeName: booking.attendeeName,
            timezone: calendar.timezone,
            hostEmail: calendar.hostEmail,
            additionalHosts: calendar.additionalHosts,
          })
        : null;
      if (gcalResult) {
        meetLink = gcalResult.meetLink;
        googleEventId = gcalResult.eventId;
        if (meetLink || googleEventId) {
          await db.execute(
            sql`UPDATE bookings SET meet_link = ${meetLink}, google_event_id = ${googleEventId} WHERE id = ${booking.id}`,
          );
        }
      }
    } catch (err) {
      logger.warn({ callId, bookingId: booking.id, err }, "Native booking: Google Calendar event creation failed");
    }

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
    });
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

    return `booking_confirmed: event="${eventType.name}", slot="${dateStr}", booking_id=${booking.id}, attendee="${attendeeName}", email="${attendeeEmail}", status="${booking.status}"`;
  } catch (err) {
    logger.error({ callId, err }, "Native booking tool execution failed");
    return "error: booking failed due to a technical issue";
  }
}

export async function executeNativeCheckAvailability(
  callId: number,
  agentId: number,
  tool: AgentTool & { type: "native_check_availability" },
  args: Record<string, unknown>,
): Promise<string> {
  logger.info({ callId, eventTypeId: tool.eventTypeId }, "Native check-availability tool invoked");
  const preferredRaw = args["preferred_date"] != null ? String(args["preferred_date"]) : null;

  try {
    const [agentCalendar] = await db
      .select({ userId: schedulingCalendarsTable.userId })
      .from(schedulingCalendarsTable)
      .where(eq(schedulingCalendarsTable.agentId, agentId));
    let authorizedUserId: string | null = null;
    if (agentCalendar) {
      authorizedUserId = agentCalendar.userId;
    } else {
      const [agentRow] = await db
        .select({ userId: agentsTable.userId })
        .from(agentsTable)
        .where(eq(agentsTable.id, agentId));
      authorizedUserId = agentRow?.userId ?? null;
    }

    const [eventType] = await db.select().from(eventTypesTable).where(eq(eventTypesTable.id, tool.eventTypeId));
    if (!eventType || !eventType.isActive) {
      return "error: the appointment type is unavailable";
    }
    const [calendar] = await db
      .select()
      .from(schedulingCalendarsTable)
      .where(eq(schedulingCalendarsTable.id, eventType.calendarId));
    if (!calendar || !calendar.isActive) {
      return "error: the calendar is unavailable";
    }
    if (authorizedUserId && calendar.userId !== authorizedUserId) {
      logger.warn({ callId, eventTypeId: tool.eventTypeId }, "Native check-availability: ownership mismatch — rejected");
      return "error: the appointment type is unavailable";
    }

    const { searchStart, minSlotStart, timeFilter } = preferredRaw
      ? parsePreferredDate(preferredRaw, calendar.timezone)
      : { searchStart: new Date(), minSlotStart: undefined, timeFilter: undefined };
    const searchEnd = new Date(searchStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    let slots = await getAvailableSlots(tool.eventTypeId, format(searchStart, "yyyy-MM-dd"), format(searchEnd, "yyyy-MM-dd"));
    if (minSlotStart) slots = slots.filter((s) => s.slotStart >= minSlotStart);
    if (timeFilter) slots = slots.filter(timeFilter);

    if (slots.length === 0) {
      const rangeDesc = preferredRaw ? `on or after "${preferredRaw}"` : "in the next 7 days";
      return `no_availability: no available slots ${rangeDesc}`;
    }

    const tz = tool.timezone || calendar.timezone || "UTC";
    const preview = slots
      .slice(0, 5)
      .map((s) => formatInTimeZone(s.slotStart, tz, "EEE MMM d 'at' h:mm a"))
      .join("; ");
    return `available_slots: count=${slots.length}, event="${eventType.name}", duration_mins=${eventType.durationMinutes}, timezone="${tz}", next="${preview}"`;
  } catch (err) {
    logger.error({ callId, err }, "Native check-availability tool execution failed");
    return "error: availability check failed due to a technical issue";
  }
}

export async function executeNativeReschedule(
  callId: number,
  agentId: number,
  tool: AgentTool & { type: "native_reschedule" },
  args: Record<string, unknown>,
): Promise<string> {
  logger.info({ callId }, "Native reschedule tool invoked");
  const bookingId = Number(args["booking_id"] ?? args["bookingId"] ?? 0);
  const preferredRaw = args["preferred_date"] != null ? String(args["preferred_date"]) : null;
  if (!bookingId) {
    return "error: booking_id is required to reschedule";
  }

  try {
    const [agentCalendar] = await db
      .select({ userId: schedulingCalendarsTable.userId })
      .from(schedulingCalendarsTable)
      .where(eq(schedulingCalendarsTable.agentId, agentId));
    let authorizedUserId: string | null = null;
    if (agentCalendar) {
      authorizedUserId = agentCalendar.userId;
    } else {
      const [agentRow] = await db
        .select({ userId: agentsTable.userId })
        .from(agentsTable)
        .where(eq(agentsTable.id, agentId));
      authorizedUserId = agentRow?.userId ?? null;
    }

    const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
    if (!existing || existing.status === "cancelled") {
      return `error: no active booking found with reference ${bookingId}`;
    }

    if (authorizedUserId && existing.userId !== authorizedUserId) {
      logger.warn(
        { callId, bookingId, authorizedUserId, bookingUserId: existing.userId },
        "Native reschedule: ownership mismatch — rejected",
      );
      return `error: no active booking found with reference ${bookingId}`;
    }

    const [eventType] = await db.select().from(eventTypesTable).where(eq(eventTypesTable.id, existing.eventTypeId));
    if (!eventType) {
      return "error: appointment type not found for this booking";
    }

    const [calendar] = await db
      .select()
      .from(schedulingCalendarsTable)
      .where(eq(schedulingCalendarsTable.id, existing.calendarId));
    if (!calendar || !calendar.isActive) {
      return "error: calendar is unavailable";
    }

    const { searchStart, minSlotStart, timeFilter } = preferredRaw
      ? parsePreferredDate(preferredRaw, calendar.timezone)
      : { searchStart: new Date(), minSlotStart: undefined, timeFilter: undefined };
    if (preferredRaw) {
      logger.info({ callId, preferredRaw, searchStart, minSlotStart }, "Native reschedule: preferred date resolved");
    }
    const searchEnd = new Date(searchStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    let slots = await getAvailableSlots(eventType.id, format(searchStart, "yyyy-MM-dd"), format(searchEnd, "yyyy-MM-dd"));
    if (minSlotStart) slots = slots.filter((s) => s.slotStart >= minSlotStart);
    if (timeFilter) slots = slots.filter(timeFilter);
    const filteredSlots = slots.filter((s) => s.slotStart.getTime() !== existing.slotStart.getTime());
    if (filteredSlots.length === 0) {
      const rangeDesc = preferredRaw ? `on or after "${preferredRaw}"` : "in the next 7 days";
      return `error: no other available slots ${rangeDesc}`;
    }

    const newSlot = filteredSlots[0]!;
    const newStart = newSlot.slotStart;
    const newEnd = newSlot.slotEnd;
    const lockKey = buildSlotLockKey(calendar.id, newStart);
    let newBooking: typeof bookingsTable.$inferSelect | undefined;
    let lockConflict = false;

    await db.transaction(async (tx) => {
      const lockResult = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS acquired`);
      const acquired = (lockResult.rows[0] as { acquired?: boolean })?.acquired === true;
      if (!acquired) {
        lockConflict = true;
        return;
      }

      const bufBefore = addMinutes(newStart, -eventType.bufferBeforeMins);
      const bufAfter = addMinutes(newEnd, eventType.bufferAfterMins);

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

      const exactOverlapCount = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(bookingsTable)
        .where(
          and(
            eq(bookingsTable.calendarId, calendar.id),
            or(eq(bookingsTable.status, "pending"), eq(bookingsTable.status, "confirmed")),
            sql`${bookingsTable.slotStart} < ${newEnd}`,
            sql`${bookingsTable.slotEnd} > ${newStart}`,
          ),
        )
        .then((r) => r[0]?.count ?? 0);

      if (exactOverlapCount >= eventType.maxBookingsPerSlot || overlapCount > exactOverlapCount) {
        lockConflict = true;
        return;
      }

      await tx.update(bookingsTable).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(bookingsTable.id, bookingId));

      const [inserted] = await tx
        .insert(bookingsTable)
        .values({
          eventTypeId: eventType.id,
          calendarId: calendar.id,
          callId,
          userId: calendar.userId,
          attendeeName: existing.attendeeName,
          attendeeEmail: existing.attendeeEmail,
          attendeeNotes: existing.attendeeNotes,
          slotStart: newStart,
          slotEnd: newEnd,
          status: eventType.confirmationMode === "instant" ? "confirmed" : "pending",
          bookedVia: "agent",
          rescheduledFromId: bookingId,
        })
        .returning();
      newBooking = inserted;
    });

    if (lockConflict || !newBooking) {
      return "error: slot was just taken — reschedule failed";
    }

    const dateStr = format(newStart, "EEEE, MMMM do 'at' h:mm a");
    logger.info({ callId, oldBookingId: bookingId, newBookingId: newBooking.id }, "Native reschedule complete");

    // Google Calendar sync: delete the old event, create a new one with a Meet link (best-effort)
    let meetLink: string | null = null;
    try {
      const oldGcalRow = await db.execute(
        sql`SELECT google_event_id FROM bookings WHERE id = ${bookingId}`,
      );
      const existingGoogleEventId = (oldGcalRow.rows[0] as { google_event_id?: string | null })
        ?.google_event_id ?? null;
      const calRow = await db.execute(
        sql`SELECT google_calendar_connection_id FROM scheduling_calendars WHERE id = ${calendar.id}`,
      );
      const calendarConnectionId = (calRow.rows[0] as { google_calendar_connection_id?: string | null })
        ?.google_calendar_connection_id ?? null;
      const connectionId = calendarConnectionId ?? (await getFirstConnectionForUser(calendar.userId))?.id ?? null;

      if (existingGoogleEventId && connectionId) {
        await deleteCalendarEvent(connectionId, existingGoogleEventId);
      }
      if (connectionId) {
        const gcalResult = await createCalendarEvent({
          connectionId,
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
          meetLink = gcalResult.meetLink;
          await db.execute(
            sql`UPDATE bookings SET meet_link = ${gcalResult.meetLink}, google_event_id = ${gcalResult.eventId} WHERE id = ${newBooking.id}`,
          );
        }
      }
    } catch (err) {
      logger.warn({ callId, bookingId: newBooking.id, err }, "Native reschedule: Google Calendar sync failed");
    }

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
      notes: newBooking.attendeeNotes,
      meetLink,
      oldSlotStart: existing.slotStart,
    });
    void dispatchSchedulingWebhooks(calendar.userId, "scheduling.booking.rescheduled", {
      booking: {
        ...newBooking,
        slotStart: newBooking.slotStart.toISOString(),
        slotEnd: newBooking.slotEnd.toISOString(),
        cancelledAt: newBooking.cancelledAt?.toISOString() ?? null,
        createdAt: newBooking.createdAt.toISOString(),
        updatedAt: newBooking.updatedAt.toISOString(),
      },
    });

    return `reschedule_confirmed: old_booking_id=${bookingId}, new_booking_id=${newBooking.id}, new_slot="${dateStr}", status="${newBooking.status}"`;
  } catch (err) {
    logger.error({ callId, err }, "Native reschedule tool execution failed");
    return "error: reschedule failed due to a technical issue";
  }
}

export async function executeNativeCancel(
  callId: number,
  agentId: number,
  tool: AgentTool & { type: "native_cancel" },
  args: Record<string, unknown>,
): Promise<string> {
  logger.info({ callId }, "Native cancel tool invoked");
  const bookingId = Number(args["booking_id"] ?? args["bookingId"] ?? 0);
  if (!bookingId) {
    return "error: booking_id is required to cancel";
  }

  try {
    const [agentRow] = await db
      .select({ userId: agentsTable.userId })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId));
    const agentOwnerId = agentRow?.userId ?? null;

    let authorizedUserId: string | null = null;
    if (tool.calendarId) {
      const [calRow] = await db
        .select({ userId: schedulingCalendarsTable.userId })
        .from(schedulingCalendarsTable)
        .where(eq(schedulingCalendarsTable.id, tool.calendarId));
      if (!calRow || calRow.userId !== agentOwnerId) {
        logger.warn(
          { callId, toolCalendarId: tool.calendarId, agentOwnerId },
          "Native cancel: stored calendarId does not belong to agent owner — rejected",
        );
        return `error: no booking found with reference ${bookingId}`;
      }
      authorizedUserId = calRow.userId;
    } else {
      const [agentCalendar] = await db
        .select({ userId: schedulingCalendarsTable.userId })
        .from(schedulingCalendarsTable)
        .where(eq(schedulingCalendarsTable.agentId, agentId));
      authorizedUserId = agentCalendar?.userId ?? agentOwnerId;
    }

    const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
    if (!existing) {
      return `error: no booking found with reference ${bookingId}`;
    }

    if (authorizedUserId && existing.userId !== authorizedUserId) {
      logger.warn(
        { callId, bookingId, authorizedUserId, bookingUserId: existing.userId },
        "Native cancel: ownership mismatch — rejected",
      );
      return `error: no booking found with reference ${bookingId}`;
    }

    if (existing.status === "cancelled") {
      return `info: booking ${bookingId} was already cancelled`;
    }

    const [eventType] = await db.select().from(eventTypesTable).where(eq(eventTypesTable.id, existing.eventTypeId));
    const [calendar] = await db
      .select()
      .from(schedulingCalendarsTable)
      .where(eq(schedulingCalendarsTable.id, existing.calendarId));

    const cancelledAt = new Date();
    await db.update(bookingsTable).set({ status: "cancelled", cancelledAt }).where(eq(bookingsTable.id, bookingId));

    logger.info({ callId, bookingId }, "Native cancel complete");

    if (eventType && calendar) {
      // Delete the Google Calendar event (best-effort, non-blocking)
      void (async () => {
        try {
          const gcalRow = await db.execute(
            sql`SELECT google_event_id FROM bookings WHERE id = ${bookingId}`,
          );
          const existingGoogleEventId = (gcalRow.rows[0] as { google_event_id?: string | null })
            ?.google_event_id ?? null;
          if (!existingGoogleEventId) return;
          const calRow = await db.execute(
            sql`SELECT google_calendar_connection_id FROM scheduling_calendars WHERE id = ${calendar.id}`,
          );
          const calendarConnectionId = (calRow.rows[0] as { google_calendar_connection_id?: string | null })
            ?.google_calendar_connection_id ?? null;
          const connectionId = calendarConnectionId ?? (await getFirstConnectionForUser(calendar.userId))?.id ?? null;
          if (connectionId) {
            await deleteCalendarEvent(connectionId, existingGoogleEventId);
          }
        } catch (err) {
          logger.warn({ callId, bookingId, err }, "Native cancel: Google Calendar event deletion failed");
        }
      })();

      void sendBookingCancelledEmail({
        attendeeName: existing.attendeeName,
        attendeeEmail: existing.attendeeEmail,
        eventTypeName: eventType.name,
        slotStart: existing.slotStart,
        slotEnd: existing.slotEnd,
        timezone: calendar.timezone,
        hostEmail: calendar.hostEmail,
        additionalHosts: calendar.additionalHosts,
        bookingId: existing.id,
        notes: existing.attendeeNotes,
      });
      void dispatchSchedulingWebhooks(calendar.userId, "scheduling.booking.cancelled", {
        booking: {
          ...existing,
          status: "cancelled",
          cancelledAt: cancelledAt.toISOString(),
          slotStart: existing.slotStart.toISOString(),
          slotEnd: existing.slotEnd.toISOString(),
          createdAt: existing.createdAt.toISOString(),
          updatedAt: existing.updatedAt.toISOString(),
        },
      });
    }

    return `cancellation_confirmed: booking_id=${bookingId}`;
  } catch (err) {
    logger.error({ callId, err }, "Native cancel tool execution failed");
    return "error: cancellation failed due to a technical issue";
  }
}

/**
 * Execute a webhook tool. Returns a result string (success or error) so it can
 * optionally be fed back to the LLM.
 */
export async function executeWebhookTool(
  callId: number,
  tool: AgentTool & { type: "webhook" },
  args: Record<string, unknown>,
): Promise<string> {
  logger.info({ callId, url: tool.url, method: tool.method }, "Executing webhook tool");
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(tool.headers ?? {}),
    };
    if (tool.secret) headers["X-Webhook-Secret"] = tool.secret;

    const resp = await fetch(tool.url, {
      method: tool.method,
      headers,
      body: tool.method === "POST" ? JSON.stringify({ callId, toolName: tool.name, args }) : undefined,
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) {
      logger.warn({ callId, url: tool.url, status: resp.status }, "Webhook tool returned non-OK status");
      return `webhook_error: status=${resp.status}`;
    }

    logger.info({ callId, url: tool.url, status: resp.status }, "Webhook tool executed successfully");

    let body = "";
    try {
      body = await resp.text();
    } catch {
      // ignore body read errors
    }
    return body ? `webhook_result: ${body.slice(0, 500)}` : "webhook_success";
  } catch (err) {
    logger.error({ callId, url: tool.url, err }, "Webhook tool execution failed");
    return "error: webhook tool failed to execute";
  }
}

// ── parsePreferredDate (shared between pipeline.ts and webcall tool execution) ─

/**
 * Parse a natural-language or ISO preferred date string into a concrete search
 * start date, an optional minimum slot start instant for time-precision, and an
 * optional time-of-day slot filter.
 */
export function parsePreferredDate(
  raw: string,
  tz = "UTC",
): { searchStart: Date; minSlotStart?: Date; timeFilter?: (slot: TimeSlot) => boolean } {
  const now = new Date();
  const lower = raw.trim().toLowerCase();

  if (lower === "morning") {
    return { searchStart: now, timeFilter: (s) => toZonedTime(s.slotStart, tz).getHours() < 12 };
  }
  if (lower === "afternoon") {
    return {
      searchStart: now,
      timeFilter: (s) => {
        const h = toZonedTime(s.slotStart, tz).getHours();
        return h >= 12 && h < 17;
      },
    };
  }
  if (lower === "evening") {
    return { searchStart: now, timeFilter: (s) => toZonedTime(s.slotStart, tz).getHours() >= 17 };
  }

  if (lower === "today") {
    return { searchStart: now };
  }
  if (lower === "tomorrow") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return { searchStart: d };
  }

  const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dayMatch = lower.match(/^(?:(next|this)\s+)?(\w+)$/);
  if (dayMatch) {
    const modifier = dayMatch[1];
    const dayName = dayMatch[2]!;
    const dayIdx = DAY_NAMES.indexOf(dayName);
    if (dayIdx !== -1) {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      const currentDay = d.getDay();
      let daysAhead = dayIdx - currentDay;
      if (modifier === "next") {
        if (daysAhead <= 0) daysAhead += 7;
        else daysAhead += 7;
      } else {
        if (daysAhead <= 0) daysAhead += 7;
      }
      d.setDate(d.getDate() + daysAhead);
      return { searchStart: d };
    }
  }

  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    const effectiveStart = parsed > now ? parsed : now;
    const hasTimeComponent = raw.includes("T") || raw.includes(" ");
    return {
      searchStart: effectiveStart,
      minSlotStart: hasTimeComponent ? effectiveStart : undefined,
    };
  }

  return { searchStart: now };
}

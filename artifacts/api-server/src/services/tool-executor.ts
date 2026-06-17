import { format, addMinutes } from "date-fns";
import { toZonedTime, formatInTimeZone } from "date-fns-tz";
import {
  db,
  bookingsTable,
  eventTypesTable,
  schedulingCalendarsTable,
  agentsTable,
  campaignLeadsTable,
  leadTransfersTable,
  leadTimelineTable,
  callExecutionsTable,
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
  updateCalendarEvent,
  getFirstConnectionForUser,
} from "./scheduling/google-calendar.js";
import { dispatchSchedulingWebhooks } from "../routes/scheduling/webhooks.js";
import type { AgentTool, ToolDefinition } from "../orchestration/types.js";
import { logger } from "../lib/logger.js";
import type { TimeSlot } from "./scheduling/slot-engine.js";

// ── Tool name sanitization ────────────────────────────────────────────────────

/** Fallback name used when sanitization produces an empty string. */
const FALLBACK_TOOL_NAME = "tool";

/**
 * Normalize an arbitrary, user-entered tool name into a function name that is
 * valid across every LLM provider we support (Gemini, OpenAI, Anthropic, etc.).
 *
 * Gemini rejects an entire request with a 400 "Invalid function name" error if
 * any `functionDeclarations[].name` contains spaces, non-ASCII characters (e.g.
 * Tamil text), or other disallowed symbols. To stay safe across all providers we
 * restrict to the common intersection: `[A-Za-z0-9_]`, must start with a letter
 * or underscore, max 64 chars (OpenAI/Anthropic limit; Gemini allows 128).
 *
 * Deterministic + idempotent: the same input always maps to the same output, and
 * sanitizing an already-valid name is a no-op. This lets us sanitize names both
 * when building tool definitions (outbound) and when matching tool calls returned
 * by the LLM (inbound) without drift.
 */
export function sanitizeToolName(name: string): string {
  // Decompose accented characters then drop anything outside [A-Za-z0-9_].
  let s = (name ?? "").normalize("NFKD").replace(/[^a-zA-Z0-9_]/g, "_");
  // Collapse runs of underscores and trim leading/trailing ones.
  s = s.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  // Must start with a letter or underscore — prefix one if it starts with a digit.
  if (/^[0-9]/.test(s)) s = "_" + s;
  // Enforce the 64-char max (re-trim a trailing underscore left by the slice).
  if (s.length > 64) s = s.slice(0, 64).replace(/_+$/g, "");
  // Fall back to a safe default if nothing usable survived.
  if (!s) s = FALLBACK_TOOL_NAME;
  return s;
}

/**
 * Find the tool an LLM invoked, matching against the same sanitized name that was
 * sent in the outbound tool definitions. Tries the raw name first (valid
 * snake_case tools behave exactly as before), then the sanitized forms so tools
 * whose stored names contain spaces/non-ASCII still resolve to the right tool.
 */
export function matchToolByName<T extends { name: string }>(
  tools: T[],
  calledName: string,
): T | undefined {
  return (
    tools.find((t) => t.name === calledName) ??
    tools.find((t) => sanitizeToolName(t.name) === calledName) ??
    tools.find((t) => sanitizeToolName(t.name) === sanitizeToolName(calledName))
  );
}

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

  const defs: ToolDefinition[] = [
    ...builtInEndCall,
    ...tools.map((t): ToolDefinition => {
      if (t.type === "native_booking") {
        return {
          name: t.name,
          description:
            t.description +
            " Call this tool to create the actual booking. Do NOT confirm the appointment to the caller before calling this tool. Required fields: attendee_name (ask the caller if not yet provided) and attendee_email (ask the caller if not yet provided).",
          parameters: {
            type: "object",
            properties: {
              attendee_name: { type: "string", description: "Full name of the person being booked" },
              attendee_email: { type: "string", description: "Email address of the person being booked" },
              preferred_date: {
                type: "string",
                description:
                  "Optional preferred date or time of day for the appointment, e.g. 'next Tuesday', '2025-06-10', 'morning', or 'afternoon'. The system will find the first available slot on or after this date/time. If you ran check_availability first, pass the ISO 8601 string returned there (e.g. '2026-06-06T20:30:00+05:30') verbatim — do NOT convert or reformat it.",
              },
              meeting_type: {
                type: "string",
                enum: ["google_meet", "in_person"],
                description:
                  "Where the meeting takes place. Use 'google_meet' for a video call with an auto-generated Google Meet link, or 'in_person' for an in-person meeting at a physical address. Ask the caller which they prefer. Defaults to 'google_meet' if not specified.",
              },
              meeting_address: {
                type: "string",
                description:
                  "The physical address for the meeting. Required only when meeting_type is 'in_person'. Ask the caller for the address before booking.",
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
                description:
                  "The requested date/time for the new slot." +
                  " When the caller names a specific time (e.g. '12 PM', '2:30 PM', 'noon'), pass a full ISO 8601 datetime with timezone offset, e.g. '2026-06-18T12:00:00+05:30'." +
                  " The system will book EXACTLY that slot if available, or return the nearest alternatives — it will NEVER silently pick a different time." +
                  " For vague preferences (e.g. 'morning', 'next Tuesday') a plain string is fine.",
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
          description:
            t.description +
            " The 'next' field in the response lists slots as ISO 8601 strings with timezone offsets (e.g. '2026-06-06T20:30:00+05:30') followed by a human-readable label in parentheses. When calling book_appointment after checking availability, pass the ISO string (e.g. '2026-06-06T20:30:00+05:30') verbatim as preferred_date — do NOT convert or reformat it." +
            " This tool ONLY checks availability. It does NOT create a booking. After presenting slots, collect the caller's name and email, then call the booking tool to create the booking. Never confirm to the caller that an appointment is booked without first calling the booking tool and receiving a booking_confirmed result.",
          parameters: {
            type: "object",
            properties: {
              preferred_date: {
                type: "string",
                description:
                  "Optional preferred date or time of day to check availability for, e.g. 'next Tuesday', '2025-06-10', 'tomorrow morning'. Defaults to the next 7 days.",
              },
              timezone: {
                type: "string",
                description: "IANA timezone, e.g. 'America/New_York' or 'Asia/Kolkata'. Defaults to Asia/Kolkata if not provided.",
              },
            },
            required: [],
          },
        };
      }
      if (t.type === "native_list_bookings") {
        return {
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: {
              attendee_name: {
                type: "string",
                description: "Full name of the caller whose bookings you want to look up",
              },
              timezone: {
                type: "string",
                description: "IANA timezone, e.g. 'America/New_York' or 'Asia/Kolkata'. Defaults to Asia/Kolkata if not provided.",
              },
            },
            required: ["attendee_name"],
          },
        };
      }
      if (t.type === "transfer_cold") {
        return {
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: {
              targetNumber: { type: "string", description: "Phone number to transfer the call to, e.g. +911234567890" },
              holdMessage:  { type: "string", description: "Optional message to speak before transferring (e.g. 'Please hold while we connect you')" },
            },
            required: ["targetNumber"],
          },
        };
      }
      if (t.type === "transfer_warm") {
        return {
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: {
              targetNumber:  { type: "string", description: "Phone number of the human agent to transfer the call to" },
              holdMessage:   { type: "string", description: "Optional message to speak before transferring (e.g. 'Please hold for a moment while I connect you')" },
            },
            required: ["targetNumber"],
          },
        };
      }
      if (t.type === "transfer_agent") {
        return {
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: {
              targetAgentId: { type: "string", description: "ID of the specialist agent to transfer the call to" },
              context:       { type: "string", description: "Optional context to pass to the new agent about what the caller needs" },
            },
            required: ["targetAgentId"],
          },
        };
      }
      // Webhook: use caller-defined parameters if provided
      if (t.type === "webhook" && t.parameters) {
        return {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        };
      }
      // Generic fallback for call_transfer, webhook (no params), send_sms, end_call, cal_com
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

  // Normalize every function name to a provider-safe form before it reaches any
  // LLM adapter. Done in one place so custom tools, native scheduling, transfers,
  // webhook, and the built-in end_call all stay valid (e.g. Gemini 400 "Invalid
  // function name" on spaces/non-ASCII names).
  return defs.map((d) => ({ ...d, name: sanitizeToolName(d.name) }));
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
      .select({ id: schedulingCalendarsTable.id, userId: schedulingCalendarsTable.userId })
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

    // Always auto-resolve event type from agent's calendar first; legacy stored eventTypeId is a fallback only
    let resolvedEventTypeId: number | undefined;
    if (agentCalendar?.id) {
      const [firstEt] = await db
        .select({ id: eventTypesTable.id })
        .from(eventTypesTable)
        .where(and(eq(eventTypesTable.calendarId, agentCalendar.id), eq(eventTypesTable.isActive, true)))
        .limit(1);
      resolvedEventTypeId = firstEt?.id;
    }
    if (!resolvedEventTypeId && tool.eventTypeId) {
      resolvedEventTypeId = tool.eventTypeId;
    }
    if (!resolvedEventTypeId) {
      return JSON.stringify({ error: "no_event_type", message: "No event type configured for this agent's calendar. Go to Settings → Calendar to create one." });
    }

    const [eventType] = await db.select().from(eventTypesTable).where(eq(eventTypesTable.id, resolvedEventTypeId));
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
        { callId, eventTypeId: resolvedEventTypeId, authorizedUserId, calendarUserId: calendar.userId },
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
    let slots = await getAvailableSlots(eventType.id, format(searchStart, "yyyy-MM-dd"), format(searchEnd, "yyyy-MM-dd"));
    if (minSlotStart) slots = slots.filter((s) => s.slotStart >= minSlotStart);
    if (timeFilter) slots = slots.filter(timeFilter);
    if (slots.length === 0) {
      const rangeDesc = preferredRaw ? `on or after "${preferredRaw}"` : "in the next 7 days";
      logger.info({ callId, eventTypeId: eventType.id }, `Native booking: no available slots ${rangeDesc}`);
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

    const tz = calendar.timezone || "UTC";
    const dateStr = formatInTimeZone(slotStart, tz, "EEEE, MMMM do 'at' h:mm a zzz");
    logger.info(
      {
        callId,
        bookingId: booking.id,
        attendeeEmail,
        requested_datetime: preferredRaw,
        requested_timezone: tz,
        stored_datetime: slotStart.toISOString(),
        stored_timezone: "UTC (postgres timestamptz)",
        returned_slot: dateStr,
      },
      "Native booking created",
    );

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
      .select({ id: schedulingCalendarsTable.id, userId: schedulingCalendarsTable.userId })
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

    // Always auto-resolve event type from agent's calendar first; legacy stored eventTypeId is a fallback only
    let resolvedEventTypeId: number | undefined;
    if (agentCalendar?.id) {
      const [firstEt] = await db
        .select({ id: eventTypesTable.id })
        .from(eventTypesTable)
        .where(and(eq(eventTypesTable.calendarId, agentCalendar.id), eq(eventTypesTable.isActive, true)))
        .limit(1);
      resolvedEventTypeId = firstEt?.id;
    }
    if (!resolvedEventTypeId && tool.eventTypeId) {
      resolvedEventTypeId = tool.eventTypeId;
    }
    if (!resolvedEventTypeId) {
      return JSON.stringify({ error: "no_event_type", message: "No event type configured for this agent's calendar. Go to Settings → Calendar to create one." });
    }

    const [eventType] = await db.select().from(eventTypesTable).where(eq(eventTypesTable.id, resolvedEventTypeId));
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
      logger.warn({ callId, eventTypeId: resolvedEventTypeId }, "Native check-availability: ownership mismatch — rejected");
      return "error: the appointment type is unavailable";
    }

    const { searchStart, minSlotStart, timeFilter } = preferredRaw
      ? parsePreferredDate(preferredRaw, calendar.timezone)
      : { searchStart: new Date(), minSlotStart: undefined, timeFilter: undefined };
    const searchEnd = new Date(searchStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    let slots = await getAvailableSlots(eventType.id, format(searchStart, "yyyy-MM-dd"), format(searchEnd, "yyyy-MM-dd"));
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

export async function executeNativeListBookings(
  callId: number,
  agentId: number,
  tool: AgentTool & { type: "native_list_bookings" },
  args: Record<string, unknown>,
): Promise<string> {
  logger.info({ callId }, "Native list-bookings tool invoked");
  const attendeeName = String(args["attendee_name"] ?? "").trim();
  if (!attendeeName) {
    return "error: attendee_name is required to look up bookings";
  }

  try {
    // Determine authorized user for ownership scoping (same pattern as other native executors)
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

    // Fetch upcoming, active bookings with a case-insensitive name match.
    // Rescheduling produces two DB rows: the original row is set to status="rescheduled"
    // and a new row is inserted for the new slot. We must exclude "rescheduled" rows here
    // so the AI only sees the current (new) booking and not the superseded original.
    const nameLike = `%${attendeeName.toLowerCase()}%`;
    const now = new Date();
    const owned = await db
      .select({
        id: bookingsTable.id,
        attendeeName: bookingsTable.attendeeName,
        attendeeEmail: bookingsTable.attendeeEmail,
        slotStart: bookingsTable.slotStart,
        status: bookingsTable.status,
        calendarId: bookingsTable.calendarId,
        eventTypeId: bookingsTable.eventTypeId,
        googleEventId: sql<string | null>`${bookingsTable}.google_event_id`,
      })
      .from(bookingsTable)
      .where(
        and(
          sql`lower(${bookingsTable.attendeeName}) like ${nameLike}`,
          sql`${bookingsTable.slotStart} >= ${now.toISOString()}`,
          sql`${bookingsTable.status} != 'cancelled'`,
          sql`${bookingsTable.status} != 'rescheduled'`,
          authorizedUserId ? eq(bookingsTable.userId, authorizedUserId) : sql`true`,
          tool.calendarId ? eq(bookingsTable.calendarId, tool.calendarId) : sql`true`,
        ),
      )
      .orderBy(bookingsTable.slotStart)
      .limit(5);

    if (owned.length === 0) {
      return `no_bookings_found: no upcoming bookings found for "${attendeeName}". Ask the caller to double-check the name on their booking.`;
    }

    // Resolve timezone: args → tool config → first booking's calendar → Asia/Kolkata
    let tz = (args["timezone"] != null ? String(args["timezone"]) : null) ?? tool.timezone ?? null;
    if (!tz && owned[0]?.calendarId) {
      const [cal] = await db
        .select({ timezone: schedulingCalendarsTable.timezone })
        .from(schedulingCalendarsTable)
        .where(eq(schedulingCalendarsTable.id, owned[0].calendarId));
      tz = cal?.timezone ?? null;
    }
    tz = tz ?? "Asia/Kolkata";

    // Resolve event type names in bulk
    const etIds = [...new Set(owned.map((b) => b.eventTypeId))];
    const etRows = etIds.length
      ? await db.select({ id: eventTypesTable.id, name: eventTypesTable.name }).from(eventTypesTable).where(sql`${eventTypesTable.id} in (${sql.join(etIds.map((id) => sql`${id}`), sql`, `)})`)
      : [];
    const etMap = new Map(etRows.map((e) => [e.id, e.name]));

    const list = owned.map((b) => {
      const eventName = etMap.get(b.eventTypeId) ?? "Appointment";
      const dateStr = formatInTimeZone(b.slotStart, tz, "EEE MMM d 'at' h:mm a zzz");
      logger.debug(
        {
          callId,
          bookingId: b.id,
          attendeeEmail: b.attendeeEmail,
          calendarEventId: b.googleEventId ?? null,
          slotStartUtc: b.slotStart.toISOString(),
          displayTime: dateStr,
        },
        "list_bookings: returning booking to AI",
      );
      return `booking_id=${b.id}, event="${eventName}", iso_start=${b.slotStart.toISOString()}, date="${dateStr}", status="${b.status}"`;
    });

    return `bookings_found: count=${owned.length}, ${list.join(" | ")}`;
  } catch (err) {
    logger.error({ callId, err }, "Native list-bookings tool execution failed");
    return "error: booking lookup failed due to a technical issue";
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

    const { searchStart, minSlotStart, timeFilter, isExactTime } = preferredRaw
      ? parsePreferredDate(preferredRaw, calendar.timezone)
      : { searchStart: new Date(), minSlotStart: undefined, timeFilter: undefined, isExactTime: false };
    if (preferredRaw) {
      logger.info(
        { callId, preferredRaw, searchStart, minSlotStart, isExactTime },
        "Native reschedule: preferred date resolved",
      );
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

    // ── Exact-time enforcement ──────────────────────────────────────────────
    // When the caller supplied a specific clock time (isExactTime=true) we MUST
    // land on that exact slot.  Auto-picking the first available slot when the
    // requested time is unavailable causes silent, wrong reschedules.
    let chosenSlot: TimeSlot;
    if (isExactTime && minSlotStart) {
      const EXACT_TOLERANCE_MS = 60_000; // 1-minute window to absorb rounding
      const exactMatch = filteredSlots.find(
        (s) => Math.abs(s.slotStart.getTime() - minSlotStart.getTime()) <= EXACT_TOLERANCE_MS,
      );

      const tz = calendar.timezone || "UTC";
      const requestedLabel = formatInTimeZone(minSlotStart, tz, "EEEE, MMMM do 'at' h:mm a");

      logger.info(
        { callId, requestedLabel, exactMatch: !!exactMatch, availableCount: filteredSlots.length },
        "Native reschedule: exact-time slot check",
      );

      if (!exactMatch) {
        // Slot not available — surface up to 5 nearby alternatives, never auto-pick
        const alternatives = filteredSlots
          .slice(0, 5)
          .map((s) => formatInTimeZone(s.slotStart, tz, "EEE MMM d 'at' h:mm a"))
          .join("; ");
        const altMsg = alternatives ? ` Available nearby slots: ${alternatives}` : " No nearby slots available.";
        return `error: requested slot "${requestedLabel}" is not available.${altMsg}`;
      }

      logger.info({ callId, confirmedSlot: exactMatch.slotStart }, "Native reschedule: exact slot confirmed");
      chosenSlot = exactMatch;
    } else {
      // Vague preference (morning / next Tuesday / etc.) — first available is fine
      chosenSlot = filteredSlots[0]!;
    }

    const newStart = chosenSlot.slotStart;
    const newEnd = chosenSlot.slotEnd;
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

    const tz = calendar.timezone || "UTC";
    const dateStr = formatInTimeZone(newStart, tz, "EEEE, MMMM do 'at' h:mm a zzz");

    // Google Calendar sync info for debug logging (filled in below)
    const gcalStart = formatInTimeZone(newStart, tz, "yyyy-MM-dd'T'HH:mm:ss");
    logger.info(
      {
        callId,
        oldBookingId: bookingId,
        newBookingId: newBooking.id,
        requested_datetime: preferredRaw,
        requested_timezone: tz,
        stored_datetime: newStart.toISOString(),
        stored_timezone: "UTC (postgres timestamptz)",
        google_event_start: gcalStart,
        google_event_timezone: tz,
        returned_slot: dateStr,
      },
      "Native reschedule complete",
    );

    // Google Calendar sync: patch the existing event in-place (best-effort)
    // Using patch/update instead of delete+create so attendees get a seamless
    // "time changed" notification rather than a cancellation + new invite.
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

      if (connectionId) {
        logger.info(
          { callId, bookingId, existingGoogleEventId, connectionId },
          "Agent reschedule: syncing Google Calendar event",
        );
        const gcalResult = existingGoogleEventId
          ? await updateCalendarEvent({
              connectionId,
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
            })
          : await createCalendarEvent({
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
 *
 * `isExactTime` is true when the caller supplied a specific clock time (e.g.
 * "2026-06-18T12:00" or "2026-06-18 12:00 PM").  The reschedule tool uses this
 * to enforce exact-slot matching instead of silently falling back to the first
 * available slot.
 */
export function parsePreferredDate(
  raw: string,
  tz = "UTC",
): { searchStart: Date; minSlotStart?: Date; timeFilter?: (slot: TimeSlot) => boolean; isExactTime?: boolean } {
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
    const hasTimeComponent = raw.includes("T") || raw.includes(":");
    return {
      searchStart: effectiveStart,
      minSlotStart: hasTimeComponent ? effectiveStart : undefined,
      isExactTime: hasTimeComponent,
    };
  }

  return { searchStart: now };
}

// ── Transfer lead DB helper ───────────────────────────────────────────────────
// Not a scheduling function — re-exported here so pipeline.ts can import it
// from one place without circular dependencies.

export async function writeTransferLeadDb(
  opts: {
    callId: number;
    campaignLeadId: number | null;
    transferTo: string;
    type: "cold" | "warm" | "agent";
    summary?: string;
  },
): Promise<void> {
  const { callId, campaignLeadId, transferTo, type, summary } = opts;
  if (!campaignLeadId) return;

  let campaignId: number | undefined;
  let batchId: number | null = null;
  try {
    const [lead] = await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.id, campaignLeadId));
    if (lead) {
      campaignId = lead.campaignId;
      batchId = lead.batchId ?? null;
    }
  } catch (err) {
    logger.warn({ callId, campaignLeadId, err }, "Transfer DB: failed to load lead — skipping DB writes");
    return;
  }
  if (!campaignId) return;

  let callExecutionId: number | null = null;
  try {
    const [exec] = await db.select().from(callExecutionsTable).where(eq(callExecutionsTable.callId, callId));
    if (exec) callExecutionId = exec.id;
  } catch (err) {
    logger.warn({ callId, err }, "Transfer DB: failed to resolve call execution");
  }

  let transferId: number | null = null;
  try {
    const [row] = await db.insert(leadTransfersTable).values({
      leadId: campaignLeadId,
      campaignId,
      batchId,
      callExecutionId: callExecutionId ?? undefined,
      transferredTo: transferTo,
      type,
      summary: summary ?? null,
      transferTime: new Date(),
    }).returning({ id: leadTransfersTable.id });
    transferId = row?.id ?? null;
  } catch (err) {
    logger.error({ callId, campaignLeadId, err }, "Transfer DB: lead_transfers insert failed");
  }

  try {
    await db.insert(leadTimelineTable).values({
      leadId: campaignLeadId,
      campaignId,
      eventType: `transfer_${type}`,
      data: { transferTo, summary: summary ?? null, transferId },
    });
  } catch (err) {
    logger.warn({ callId, campaignLeadId, err }, "Transfer DB: lead_timeline insert failed");
  }
}

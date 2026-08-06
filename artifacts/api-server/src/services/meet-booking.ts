/**
 * Meeting ↔ booking helpers: keep phone-call lineage when booking/rescheduling
 * from a meet-bot session, and schedule a bot rejoin of an existing Meet link.
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { addMinutes } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { db, bookingsTable, callsTable, agentsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

/** True when a calls.fromNumber/toNumber is a synthetic meet-bot key. */
export function isMeetbotCallKey(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("meetbot-");
}

/**
 * Prefer the original phone call id for bookings created during a meet session
 * so auto-dispatch can restore memoryPhone / sourceCallId later.
 */
export async function resolveBookingLineageCallId(
  sessionCallId: number,
  preferredLineageCallId?: number | null,
): Promise<number> {
  if (typeof preferredLineageCallId === "number" && preferredLineageCallId > 0) {
    return preferredLineageCallId;
  }

  const [callRow] = await db
    .select({
      fromNumber: callsTable.fromNumber,
      toNumber: callsTable.toNumber,
      metadata: callsTable.metadata,
    })
    .from(callsTable)
    .where(eq(callsTable.id, sessionCallId))
    .limit(1);

  if (!callRow) return sessionCallId;

  if (!isMeetbotCallKey(callRow.fromNumber) && !isMeetbotCallKey(callRow.toNumber)) {
    return sessionCallId;
  }

  try {
    const meta = callRow.metadata ? (JSON.parse(callRow.metadata) as Record<string, unknown>) : {};
    const fromMeta = Number(meta["meetingSourceCallId"] ?? meta["sourceCallId"] ?? 0);
    if (Number.isInteger(fromMeta) && fromMeta > 0) return fromMeta;
  } catch {
    /* ignore */
  }

  // Walk a booking that pointed at this meet session (or its reschedule chain).
  const [linked] = await db
    .select({
      callId: bookingsTable.callId,
      rescheduledFromId: bookingsTable.rescheduledFromId,
    })
    .from(bookingsTable)
    .where(eq(bookingsTable.callId, sessionCallId))
    .limit(1);
  if (linked?.rescheduledFromId) {
    const [prior] = await db
      .select({ callId: bookingsTable.callId })
      .from(bookingsTable)
      .where(eq(bookingsTable.id, linked.rescheduledFromId))
      .limit(1);
    if (prior?.callId && prior.callId !== sessionCallId) return prior.callId;
  }

  return sessionCallId;
}

/** Resolve agent + human phone for meet auto-dispatch from a booking's callId. */
export async function resolveDispatchContextFromCall(callId: number): Promise<{
  agentId: number | null;
  memoryPhone: string | undefined;
  sourceCallId: number | undefined;
}> {
  const [callRow] = await db
    .select({
      id: callsTable.id,
      agentId: callsTable.agentId,
      toNumber: callsTable.toNumber,
      fromNumber: callsTable.fromNumber,
      metadata: callsTable.metadata,
    })
    .from(callsTable)
    .where(eq(callsTable.id, callId))
    .limit(1);

  if (!callRow?.agentId) {
    return { agentId: null, memoryPhone: undefined, sourceCallId: undefined };
  }

  let sourceCallId: number | undefined = callRow.id;
  let memoryPhone: string | undefined;
  let meta: Record<string, unknown> = {};
  try {
    meta = callRow.metadata ? (JSON.parse(callRow.metadata) as Record<string, unknown>) : {};
  } catch {
    meta = {};
  }

  const metaPhone =
    typeof meta["meetingMemoryPhone"] === "string"
      ? meta["meetingMemoryPhone"]
      : typeof meta["memoryPhone"] === "string"
        ? meta["memoryPhone"]
        : null;
  const metaSource = Number(meta["meetingSourceCallId"] ?? meta["sourceCallId"] ?? 0);

  if (isMeetbotCallKey(callRow.fromNumber) || isMeetbotCallKey(callRow.toNumber)) {
    if (Number.isInteger(metaSource) && metaSource > 0) {
      sourceCallId = metaSource;
      const [orig] = await db
        .select({
          toNumber: callsTable.toNumber,
          fromNumber: callsTable.fromNumber,
        })
        .from(callsTable)
        .where(eq(callsTable.id, metaSource))
        .limit(1);
      const candidate = orig?.toNumber || orig?.fromNumber;
      if (candidate && !candidate.startsWith("webcall-") && !isMeetbotCallKey(candidate)) {
        memoryPhone = candidate;
      }
    }
    if (!memoryPhone && metaPhone && !metaPhone.startsWith("webcall-") && !isMeetbotCallKey(metaPhone)) {
      memoryPhone = metaPhone;
    }
  } else {
    const candidate = callRow.toNumber || callRow.fromNumber;
    if (candidate && !candidate.startsWith("webcall-") && !isMeetbotCallKey(candidate)) {
      memoryPhone = candidate;
    }
  }

  return { agentId: callRow.agentId, memoryPhone, sourceCallId };
}

/**
 * Schedule the meeting bot to rejoin an existing Meet/Zoom/Teams URL later.
 * Inserts a lightweight bookings row that meet-auto-dispatch will pick up.
 */
export async function executeScheduleMeetRejoin(opts: {
  sessionCallId: number;
  agentId: number;
  userId: string;
  meetUrl: string;
  scheduledAtRaw?: string | null;
  notes?: string | null;
  attendeeName?: string | null;
  attendeeEmail?: string | null;
  lineageCallId?: number | null;
  timezone?: string | null;
}): Promise<string> {
  const meetUrl = opts.meetUrl.trim();
  if (!/^https:\/\/(meet\.google\.com|[a-z0-9.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\//i.test(meetUrl)) {
    return "error: meet_url must be a Google Meet, Zoom, or Teams link";
  }

  const tz = (opts.timezone ?? "Asia/Kolkata").trim() || "Asia/Kolkata";
  const preferred = opts.scheduledAtRaw?.trim() || null;
  let slotStart: Date;
  if (preferred) {
    const asIso = Date.parse(preferred);
    if (!Number.isNaN(asIso)) {
      slotStart = new Date(asIso);
    } else {
      // Lazy import avoids a circular dependency with tool-executor.
      const { parsePreferredDate } = await import("./tool-executor.js");
      const parsed = parsePreferredDate(preferred, tz);
      slotStart = parsed.minSlotStart ?? parsed.searchStart;
    }
  } else {
    slotStart = addMinutes(new Date(), 60);
  }
  // Must be in the future (auto-dispatch window is near slotStart).
  if (slotStart.getTime() < Date.now() + 2 * 60 * 1000) {
    slotStart = addMinutes(new Date(), 5);
  }
  const slotEnd = addMinutes(slotStart, 30);
  const lineageCallId = await resolveBookingLineageCallId(opts.sessionCallId, opts.lineageCallId);

  const attendeeName = (opts.attendeeName?.trim() || "Meeting guest").slice(0, 120);
  const attendeeEmail = (opts.attendeeEmail?.trim() || "meeting-guest@snapserve.local").slice(0, 200);

  // Cancel any prior pending rejoin for the same link + user still in the future.
  await db
    .update(bookingsTable)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(
      and(
        eq(bookingsTable.userId, opts.userId),
        eq(bookingsTable.meetLink, meetUrl),
        eq(bookingsTable.bookedVia, "meet_rejoin"),
        ne(bookingsTable.status, "cancelled"),
        sql`${bookingsTable.slotStart} > now()`,
      ),
    );

  const [inserted] = await db
    .insert(bookingsTable)
    .values({
      eventTypeId: null,
      calendarId: null,
      callId: lineageCallId,
      userId: opts.userId,
      attendeeName,
      attendeeEmail,
      attendeeNotes: opts.notes?.trim() || "Scheduled meeting-bot rejoin",
      slotStart,
      slotEnd,
      status: "confirmed",
      bookedVia: "meet_rejoin",
      meetLink: meetUrl,
      calendarSyncStatus: "skipped",
    })
    .returning();

  if (!inserted) return "error: could not schedule meeting rejoin";

  const whenLabel = formatInTimeZone(slotStart, tz, "EEEE, MMMM do 'at' h:mm a zzz");
  logger.info(
    {
      bookingId: inserted.id,
      sessionCallId: opts.sessionCallId,
      lineageCallId,
      meetUrl,
      slotStart: slotStart.toISOString(),
      agentId: opts.agentId,
    },
    "Scheduled meeting-bot rejoin",
  );

  // Persist next-meeting facts onto contact memory when we know the phone.
  try {
    const ctx = await resolveDispatchContextFromCall(lineageCallId);
    if (ctx.memoryPhone && ctx.agentId) {
      const { rememberCallerFact } = await import("../orchestration/callerMemory.js");
      await rememberCallerFact({
        agentId: ctx.agentId,
        phoneNumber: ctx.memoryPhone,
        key: "next_meeting_at",
        value: whenLabel,
        sourceCallId: lineageCallId,
      });
      await rememberCallerFact({
        agentId: ctx.agentId,
        phoneNumber: ctx.memoryPhone,
        key: "meet_link",
        value: meetUrl,
        sourceCallId: lineageCallId,
      });
    }
  } catch (err) {
    logger.warn({ err, lineageCallId }, "Meet rejoin: memory writeback skipped");
  }

  return (
    `meet_rejoin_scheduled: booking_id=${inserted.id}, when="${whenLabel}", meet_url=${meetUrl}. ` +
    `Confirm this time to the participants. A SnapServe meeting agent will auto-join that link near the scheduled time.`
  );
}

/** Owner userId for an agent (for booking.userId). */
export async function resolveAgentOwnerUserId(agentId: number): Promise<string | null> {
  const [row] = await db
    .select({ userId: agentsTable.userId })
    .from(agentsTable)
    .where(eq(agentsTable.id, agentId))
    .limit(1);
  return row?.userId ?? null;
}

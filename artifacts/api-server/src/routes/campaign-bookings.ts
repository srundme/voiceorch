/**
 * Campaign Bookings routes — Phase 3D
 * ─────────────────────────────────────────────────────────────────────────────
 * "Which appointments were created?" — a campaign-scoped view into
 * call_bookings joined with the scheduling module's bookings table.
 * Does NOT own booking creation; that happens in the AI call flow.
 */

import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import {
  db, campaignsTable, campaignLeadsTable, campaignBatchesTable,
  callBookingsTable, bookingsTable, eventTypesTable,
} from "@workspace/db";
import { eq, and, sql, desc, or, ilike } from "drizzle-orm";

const router: IRouter = Router();

async function requireCampaign(campaignId: number, userId: string) {
  const [row] = await db.select({ id: campaignsTable.id })
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
  return row ?? null;
}

// Unified status expression: prefer scheduling bookings.status if linked
const unifiedStatus = sql<string>`coalesce(${bookingsTable.status}, ${callBookingsTable.meetingStatus})`;
// Unified meeting start time: prefer scheduling slot_start if linked
const unifiedSlotStart = sql<Date>`coalesce(${bookingsTable.slotStart}, ${callBookingsTable.meetingTime})`;
// Unified meet link
const unifiedMeetLink = sql<string>`coalesce(${bookingsTable.meetLink}, ${callBookingsTable.meetingLink})`;

// ── GET /campaigns/:id/bookings/metrics ───────────────────────────────────────

router.get("/campaigns/:id/bookings/metrics", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  if (isNaN(campaignId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const [m] = await db.select({
    today:     sql<number>`count(*) filter (where date(${callBookingsTable.createdAt} at time zone 'UTC') = current_date)::int`,
    upcoming:  sql<number>`count(*) filter (where coalesce(${bookingsTable.slotStart}, ${callBookingsTable.meetingTime}) > now() and coalesce(${bookingsTable.status}, ${callBookingsTable.meetingStatus}) not in ('cancelled', 'canceled'))::int`,
    completed: sql<number>`count(*) filter (where coalesce(${bookingsTable.status}, ${callBookingsTable.meetingStatus}) = 'completed')::int`,
    cancelled: sql<number>`count(*) filter (where coalesce(${bookingsTable.status}, ${callBookingsTable.meetingStatus}) in ('cancelled', 'canceled'))::int`,
    total:     sql<number>`count(*)::int`,
  }).from(callBookingsTable)
    .leftJoin(bookingsTable, eq(callBookingsTable.schedulingBookingId, bookingsTable.id))
    .where(eq(callBookingsTable.campaignId, campaignId));

  res.json({
    today:     m?.today     ?? 0,
    upcoming:  m?.upcoming  ?? 0,
    completed: m?.completed ?? 0,
    cancelled: m?.cancelled ?? 0,
    total:     m?.total     ?? 0,
  });
});

// ── GET /campaigns/:id/bookings ───────────────────────────────────────────────

router.get("/campaigns/:id/bookings", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  if (isNaN(campaignId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const status = String(req.query["status"] ?? "all");
  const search = String(req.query["search"] ?? "").trim();
  const page   = Math.max(0, parseInt(String(req.query["page"] ?? "0"), 10) || 0);
  const limit  = Math.min(100, Math.max(1, parseInt(String(req.query["limit"] ?? "50"), 10) || 50));

  const conditions = [eq(callBookingsTable.campaignId, campaignId)];

  if (status === "upcoming") {
    conditions.push(sql`coalesce(${bookingsTable.slotStart}, ${callBookingsTable.meetingTime}) > now()`);
    conditions.push(sql`coalesce(${bookingsTable.status}, ${callBookingsTable.meetingStatus}) not in ('cancelled', 'canceled', 'completed')`);
  } else if (status === "completed") {
    conditions.push(sql`coalesce(${bookingsTable.status}, ${callBookingsTable.meetingStatus}) = 'completed'`);
  } else if (status === "cancelled") {
    conditions.push(sql`coalesce(${bookingsTable.status}, ${callBookingsTable.meetingStatus}) in ('cancelled', 'canceled')`);
  }

  if (search) {
    conditions.push(or(
      ilike(campaignLeadsTable.name!, `%${search}%`),
      ilike(campaignLeadsTable.phone!, `%${search}%`),
    )!);
  }

  const where = and(...conditions)!;

  const [countRow] = await db.select({ count: sql<number>`count(*)::int` })
    .from(callBookingsTable)
    .leftJoin(bookingsTable, eq(callBookingsTable.schedulingBookingId, bookingsTable.id))
    .leftJoin(campaignLeadsTable, eq(callBookingsTable.leadId, campaignLeadsTable.id))
    .where(where);
  const total = countRow?.count ?? 0;

  const rows = await db.select({
    id:                  callBookingsTable.id,
    leadId:              callBookingsTable.leadId,
    callId:              callBookingsTable.callId,
    batchId:             callBookingsTable.batchId,
    schedulingBookingId: callBookingsTable.schedulingBookingId,
    bookedBy:            callBookingsTable.bookedBy,
    notes:               callBookingsTable.notes,
    createdAt:           callBookingsTable.createdAt,
    // unified computed columns
    meetingTime:  unifiedSlotStart,
    meetLink:     unifiedMeetLink,
    status:       unifiedStatus,
    // slot end (for reschedule)
    slotEnd:      bookingsTable.slotEnd,
    // event type
    eventTypeName:      eventTypesTable.name,
    eventTypeDuration:  eventTypesTable.durationMinutes,
    // lead
    leadName:     campaignLeadsTable.name,
    leadPhone:    campaignLeadsTable.phone,
    // batch
    batchName:    campaignBatchesTable.name,
  }).from(callBookingsTable)
    .leftJoin(bookingsTable,      eq(callBookingsTable.schedulingBookingId, bookingsTable.id))
    .leftJoin(eventTypesTable,    eq(bookingsTable.eventTypeId, eventTypesTable.id))
    .leftJoin(campaignLeadsTable, eq(callBookingsTable.leadId, campaignLeadsTable.id))
    .leftJoin(campaignBatchesTable, eq(callBookingsTable.batchId, campaignBatchesTable.id))
    .where(where)
    .orderBy(desc(unifiedSlotStart))
    .limit(limit)
    .offset(page * limit);

  const items = rows.map(r => ({
    id:                  r.id,
    leadId:              r.leadId,
    callId:              r.callId ?? null,
    batchId:             r.batchId ?? null,
    schedulingBookingId: r.schedulingBookingId ?? null,
    meetingTime:         r.meetingTime?.toISOString() ?? null,
    slotEnd:             r.slotEnd?.toISOString()     ?? null,
    meetLink:            r.meetLink    ?? null,
    status:              r.status      ?? "scheduled",
    bookedBy:            r.bookedBy    ?? null,
    notes:               r.notes       ?? null,
    createdAt:           r.createdAt.toISOString(),
    eventType: r.eventTypeName ? {
      name:          r.eventTypeName,
      durationMins:  r.eventTypeDuration ?? 30,
    } : null,
    lead: {
      name:  r.leadName  ?? null,
      phone: r.leadPhone ?? null,
    },
    batchName: r.batchName ?? null,
  }));

  res.json({ items, total, page, limit });
});

// ── PATCH /campaigns/:id/bookings/:bookingId/cancel ───────────────────────────

router.patch("/campaigns/:id/bookings/:bookingId/cancel", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const bookingId  = parseInt(req.params["bookingId"]!, 10);
  if (isNaN(campaignId) || isNaN(bookingId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const [cb] = await db.select()
    .from(callBookingsTable)
    .where(and(eq(callBookingsTable.id, bookingId), eq(callBookingsTable.campaignId, campaignId)));
  if (!cb) { res.status(404).json({ error: "Not found" }); return; }

  await db.update(callBookingsTable)
    .set({ meetingStatus: "cancelled", updatedAt: new Date() })
    .where(eq(callBookingsTable.id, bookingId));

  if (cb.schedulingBookingId) {
    await db.update(bookingsTable)
      .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(bookingsTable.id, cb.schedulingBookingId));
  }

  res.json({ id: bookingId, status: "cancelled" });
});

// ── PATCH /campaigns/:id/bookings/:bookingId/reschedule ───────────────────────

router.patch("/campaigns/:id/bookings/:bookingId/reschedule", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const bookingId  = parseInt(req.params["bookingId"]!, 10);
  if (isNaN(campaignId) || isNaN(bookingId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const { newTime } = req.body as { newTime?: string };
  if (!newTime) { res.status(400).json({ error: "newTime is required" }); return; }
  const newDate = new Date(newTime);
  if (isNaN(newDate.getTime())) { res.status(400).json({ error: "Invalid newTime" }); return; }

  const [cb] = await db.select()
    .from(callBookingsTable)
    .leftJoin(bookingsTable, eq(callBookingsTable.schedulingBookingId, bookingsTable.id))
    .where(and(eq(callBookingsTable.id, bookingId), eq(callBookingsTable.campaignId, campaignId)));
  if (!cb) { res.status(404).json({ error: "Not found" }); return; }

  const cbRow = cb.call_bookings;

  await db.update(callBookingsTable)
    .set({ meetingTime: newDate, meetingStatus: "scheduled", updatedAt: new Date() })
    .where(eq(callBookingsTable.id, bookingId));

  if (cbRow.schedulingBookingId) {
    // Preserve original duration if we have slotEnd
    const origSlotEnd = cb.bookings?.slotEnd;
    const origSlotStart = cb.bookings?.slotStart;
    let durationMs = 30 * 60_000;
    if (origSlotStart && origSlotEnd) {
      durationMs = origSlotEnd.getTime() - origSlotStart.getTime();
    }
    const newEnd = new Date(newDate.getTime() + durationMs);

    await db.update(bookingsTable)
      .set({ slotStart: newDate, slotEnd: newEnd, updatedAt: new Date() })
      .where(eq(bookingsTable.id, cbRow.schedulingBookingId));
  }

  res.json({ id: bookingId, meetingTime: newDate.toISOString() });
});

// ── GET /campaigns/:id/bookings/export ────────────────────────────────────────

router.get("/campaigns/:id/bookings/export", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  if (isNaN(campaignId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const rows = await db.select({
    id:          callBookingsTable.id,
    leadName:    campaignLeadsTable.name,
    leadPhone:   campaignLeadsTable.phone,
    meetingTime: unifiedSlotStart,
    eventType:   eventTypesTable.name,
    meetLink:    unifiedMeetLink,
    bookedBy:    callBookingsTable.bookedBy,
    status:      unifiedStatus,
    batchName:   campaignBatchesTable.name,
    createdAt:   callBookingsTable.createdAt,
  }).from(callBookingsTable)
    .leftJoin(bookingsTable,      eq(callBookingsTable.schedulingBookingId, bookingsTable.id))
    .leftJoin(eventTypesTable,    eq(bookingsTable.eventTypeId, eventTypesTable.id))
    .leftJoin(campaignLeadsTable, eq(callBookingsTable.leadId, campaignLeadsTable.id))
    .leftJoin(campaignBatchesTable, eq(callBookingsTable.batchId, campaignBatchesTable.id))
    .where(eq(callBookingsTable.campaignId, campaignId))
    .orderBy(desc(unifiedSlotStart))
    .limit(5000);

  const headers = ["ID", "Lead Name", "Phone", "Meeting Time", "Event Type", "Meet Link", "Booked By", "Status", "Batch", "Created At"];
  const csvRows = rows.map(r => [
    r.id, r.leadName ?? "", r.leadPhone ?? "",
    r.meetingTime?.toISOString() ?? "",
    r.eventType ?? "", r.meetLink ?? "",
    r.bookedBy ?? "", r.status ?? "",
    r.batchName ?? "", r.createdAt.toISOString(),
  ].join(","));

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="bookings-${campaignId}.csv"`);
  res.send([headers.join(","), ...csvRows].join("\n"));
});

export default router;

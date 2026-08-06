import { Router } from "express";
import { getAuth } from "../lib/auth-compat.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext } from "../middlewares/clientContext.js";
import {
  db,
  campaignLeadsTable,
  campaignsTable,
  campaignBatchesTable,
  scheduledCallbacksTable,
  bookingsTable,
  leadTransfersTable,
  activityLogsTable,
  batchHealthSnapshotsTable,
} from "@workspace/db";
import { eq, and, gte, lt, sql, desc, count, inArray } from "drizzle-orm";

const router = Router();

router.use(requireAuth, clientContext);

/* ── helpers ──────────────────────────────────────────────────────────────── */

interface LeadStateRow {
  callStatus: string;
  operationalOutcome: string;
}

function todayUtcBounds(): { start: Date; end: Date } {
  const now  = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end   = new Date(start.getTime() + 86_400_000);
  return { start, end };
}

async function takeSnapshot(batchId: number, userId: string) {
  const batch = await db.query.campaignBatchesTable.findFirst({
    where: and(eq(campaignBatchesTable.id, batchId)),
    columns: { campaignId: true },
  });
  if (!batch) return null;

  const rows: LeadStateRow[] = await db
    .select({
      callStatus:         campaignLeadsTable.callStatus,
      operationalOutcome: campaignLeadsTable.operationalOutcome,
    })
    .from(campaignLeadsTable)
    .innerJoin(campaignsTable, eq(campaignLeadsTable.campaignId, campaignsTable.id))
    .where(
      and(
        eq(campaignLeadsTable.batchId, batchId),
        eq(campaignsTable.userId, userId),
      )
    );

  const counts = {
    totalLeads:    rows.length,
    validLeads:    rows.filter((r: LeadStateRow) => r.callStatus !== "skipped").length,
    duplicates:    0,
    queued:        rows.filter((r: LeadStateRow) => r.callStatus === "pending").length,
    calling:       rows.filter((r: LeadStateRow) => r.callStatus === "calling").length,
    connected:     rows.filter((r: LeadStateRow) => r.callStatus === "connected").length,
    completed:     rows.filter((r: LeadStateRow) => r.callStatus === "completed" || r.callStatus === "transferred").length,
    callbacks:     rows.filter((r: LeadStateRow) => r.operationalOutcome === "callback_requested").length,
    incomingCalls: 0,
    booked:        rows.filter((r: LeadStateRow) => r.operationalOutcome === "booking_created").length,
    transferred:   rows.filter((r: LeadStateRow) => r.operationalOutcome === "transfer_completed").length,
    failed:        rows.filter((r: LeadStateRow) => r.callStatus === "failed" || r.operationalOutcome === "failed").length,
    noPickup:      rows.filter((r: LeadStateRow) => r.operationalOutcome === "no_contact").length,
    interested:    rows.filter((r: LeadStateRow) => r.operationalOutcome === "interest_confirmed").length,
  };

  const outcomeBreakdown: Record<string, number> = {};
  for (const r of rows) {
    outcomeBreakdown[r.operationalOutcome] = (outcomeBreakdown[r.operationalOutcome] ?? 0) + 1;
  }

  const [snap] = await db
    .insert(batchHealthSnapshotsTable)
    .values({
      batchId,
      campaignId: batch.campaignId,
      ...counts,
      operationalOutcomeBreakdown: outcomeBreakdown,
    })
    .returning();

  return snap;
}

/* ── GET /command-center/kpis ─────────────────────────────────────────────── */
router.get("/command-center/kpis", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { start: todayStart, end: todayEnd } = todayUtcBounds();

  try {
    const userCampaigns = await db
      .select({ id: campaignsTable.id })
      .from(campaignsTable)
      .where(eq(campaignsTable.userId, userId));

    const campaignIds = userCampaigns.map((c: { id: number }) => c.id);

    if (campaignIds.length === 0) {
      res.json({
        liveCalls: 0, queued: 0, callbacksDue: 0, incomingCalls: 0,
        bookingsToday: 0, transfersToday: 0, noPickup: 0, failed: 0,
        connected: 0, interested: 0,
      });
      return;
    }

    const [
      liveCallsRes,
      queuedRes,
      callbacksDueRes,
      bookingsTodayRes,
      transfersTodayRes,
      noPickupRes,
      failedRes,
      connectedRes,
      interestedRes,
    ] = await Promise.all([
      db.select({ n: count() }).from(campaignLeadsTable)
        .where(and(
          inArray(campaignLeadsTable.campaignId, campaignIds),
          eq(campaignLeadsTable.callStatus, "calling"),
        )),

      db.select({ n: count() }).from(campaignLeadsTable)
        .where(and(
          inArray(campaignLeadsTable.campaignId, campaignIds),
          eq(campaignLeadsTable.callStatus, "pending"),
        )),

      db.select({ n: count() }).from(scheduledCallbacksTable)
        .where(and(
          eq(scheduledCallbacksTable.status, "pending"),
          lt(scheduledCallbacksTable.scheduledAt, new Date()),
        )),

      db.select({ n: count() }).from(bookingsTable)
        .where(and(
          eq(bookingsTable.userId, userId),
          gte(bookingsTable.createdAt, todayStart),
          lt(bookingsTable.createdAt, todayEnd),
        )),

      db.select({ n: count() }).from(leadTransfersTable)
        .where(and(
          inArray(leadTransfersTable.campaignId, campaignIds),
          gte(leadTransfersTable.createdAt, todayStart),
          lt(leadTransfersTable.createdAt, todayEnd),
        )),

      db.select({ n: count() }).from(campaignLeadsTable)
        .where(and(
          inArray(campaignLeadsTable.campaignId, campaignIds),
          eq(campaignLeadsTable.operationalOutcome, "no_contact"),
        )),

      db.select({ n: count() }).from(campaignLeadsTable)
        .where(and(
          inArray(campaignLeadsTable.campaignId, campaignIds),
          eq(campaignLeadsTable.callStatus, "failed"),
        )),

      db.select({ n: count() }).from(campaignLeadsTable)
        .where(and(
          inArray(campaignLeadsTable.campaignId, campaignIds),
          inArray(campaignLeadsTable.operationalOutcome, [
            "booking_created", "transfer_completed",
            "callback_requested", "interest_confirmed",
          ]),
        )),

      db.select({ n: count() }).from(campaignLeadsTable)
        .where(and(
          inArray(campaignLeadsTable.campaignId, campaignIds),
          eq(campaignLeadsTable.operationalOutcome, "interest_confirmed"),
        )),
    ]);

    res.json({
      liveCalls:      liveCallsRes[0]?.n      ?? 0,
      queued:         queuedRes[0]?.n         ?? 0,
      callbacksDue:   callbacksDueRes[0]?.n   ?? 0,
      incomingCalls:  0,
      bookingsToday:  bookingsTodayRes[0]?.n  ?? 0,
      transfersToday: transfersTodayRes[0]?.n ?? 0,
      noPickup:       noPickupRes[0]?.n       ?? 0,
      failed:         failedRes[0]?.n         ?? 0,
      connected:      connectedRes[0]?.n      ?? 0,
      interested:     interestedRes[0]?.n     ?? 0,
    });
  } catch (err) {
    req.log.error({ err }, "command-center/kpis failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /command-center/live-ops ─────────────────────────────────────────── */
router.get("/command-center/live-ops", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const limit = Math.min(Number(req.query.limit) || 50, 200);

  try {
    const rows = await db
      .select({
        leadId:             campaignLeadsTable.id,
        phone:              campaignLeadsTable.phone,
        name:               campaignLeadsTable.name,
        campaignId:         campaignLeadsTable.campaignId,
        campaignName:       campaignsTable.name,
        batchId:            campaignLeadsTable.batchId,
        batchName:          campaignBatchesTable.name,
        callStatus:         campaignLeadsTable.callStatus,
        disposition:        campaignLeadsTable.disposition,
        operationalOutcome: campaignLeadsTable.operationalOutcome,
        lastActivityAt:     campaignLeadsTable.lastAttemptAt,
        createdAt:          campaignLeadsTable.createdAt,
      })
      .from(campaignLeadsTable)
      .innerJoin(campaignsTable, eq(campaignLeadsTable.campaignId, campaignsTable.id))
      .leftJoin(campaignBatchesTable, eq(campaignLeadsTable.batchId, campaignBatchesTable.id))
      .where(eq(campaignsTable.userId, userId))
      .orderBy(
        desc(sql`COALESCE(${campaignLeadsTable.lastAttemptAt}, ${campaignLeadsTable.createdAt})`)
      )
      .limit(limit);

    res.json({
      rows: rows.map(r => ({
        ...r,
        durationSeconds: null,
        lastActivityAt:  r.lastActivityAt?.toISOString() ?? null,
        createdAt:       r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "command-center/live-ops failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /command-center/activity-stream ─────────────────────────────────── */
router.get("/command-center/activity-stream", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const limit = Math.min(Number(req.query.limit) || 30, 100);

  try {
    const events = await db
      .select()
      .from(activityLogsTable)
      .where(eq(activityLogsTable.userId, userId))
      .orderBy(desc(activityLogsTable.createdAt))
      .limit(limit);

    res.json({
      events: events.map(e => ({
        id:           e.id,
        type:         e.eventType,
        resourceType: e.resourceType ?? null,
        resourceId:   e.resourceId   ?? null,
        description:  e.description,
        createdAt:    e.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "command-center/activity-stream failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── POST /command-center/snapshots/:batchId ──────────────────────────────── */
router.post("/command-center/snapshots/:batchId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const batchId = Number(req.params.batchId);
  if (isNaN(batchId)) { res.status(400).json({ error: "Invalid batchId" }); return; }

  try {
    const batch = await db
      .select({ id: campaignBatchesTable.id })
      .from(campaignBatchesTable)
      .innerJoin(campaignsTable, eq(campaignBatchesTable.campaignId, campaignsTable.id))
      .where(and(eq(campaignBatchesTable.id, batchId), eq(campaignsTable.userId, userId)))
      .limit(1);

    if (!batch.length) { res.status(404).json({ error: "Batch not found" }); return; }

    const snap = await takeSnapshot(batchId, userId);
    if (!snap) { res.status(500).json({ error: "Snapshot failed" }); return; }

    res.json({
      ...snap,
      snapshotTime: snap.snapshotTime.toISOString(),
      createdAt:    snap.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "command-center/snapshots failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export { takeSnapshot };
export default router;

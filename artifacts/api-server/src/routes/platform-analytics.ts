/**
 * Platform Analytics routes
 * Operational-outcome–driven analytics across all campaigns.
 * Never uses disposition as primary metric — always operationalOutcome.
 */

import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import {
  db, campaignsTable, campaignLeadsTable, campaignBatchesTable,
  batchDailyMetricsTable, callExecutionsTable,
  callBookingsTable, callCallbacksTable, callTransfersTable,
  leadSourcesTable, agentsTable, callsTable,
} from "@workspace/db";
import { eq, and, sql, gte, lte, inArray, isNotNull, desc } from "drizzle-orm";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDateRange(q: Record<string, unknown>) {
  const now = new Date();
  const from = q["from"] ? new Date(q["from"] as string) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to   = q["to"]   ? new Date(q["to"]   as string) : new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (q["to"]) { to.setHours(23, 59, 59, 999); }
  return { from, to };
}

async function getCampaignIds(userId: string): Promise<number[]> {
  const rows = await db.select({ id: campaignsTable.id })
    .from(campaignsTable)
    .where(eq(campaignsTable.userId, userId));
  return rows.map(r => r.id);
}

const EMPTY_OVERVIEW = {
  totalLeads: 0, called: 0, connected: 0, interested: 0, booked: 0, transferred: 0,
  connectionRate: 0, bookingRate: 0, transferRate: 0, callbackSuccessRate: 0,
  avgDurationSeconds: 0, dailyTrend: [],
};

// ── GET /api/platform/analytics/overview ─────────────────────────────────────
router.get("/platform/analytics/overview", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { from, to } = parseDateRange(req.query as Record<string, unknown>);
  const campaignIds = await getCampaignIds(userId);
  if (campaignIds.length === 0) { res.json(EMPTY_OVERVIEW); return; }

  // Lead funnel counts
  const [leadStats] = await db.select({
    total:       sql<number>`count(*)::int`,
    called:      sql<number>`count(*) filter (where call_attempts > 0)::int`,
    connected:   sql<number>`count(*) filter (where operational_outcome not in ('pending','no_pickup','failed','dnc'))::int`,
    interested:  sql<number>`count(*) filter (where operational_outcome in ('interested','booked','transferred','callback'))::int`,
    booked:      sql<number>`count(*) filter (where operational_outcome = 'booked')::int`,
    transferred: sql<number>`count(*) filter (where operational_outcome = 'transferred')::int`,
  }).from(campaignLeadsTable).where(and(
    inArray(campaignLeadsTable.campaignId, campaignIds),
    gte(campaignLeadsTable.createdAt, from),
    lte(campaignLeadsTable.createdAt, to),
  ));

  // Callback success rate
  const [cbStats] = await db.select({
    total:     sql<number>`count(*)::int`,
    completed: sql<number>`count(*) filter (where status = 'completed')::int`,
  }).from(callCallbacksTable).where(and(
    inArray(callCallbacksTable.campaignId, campaignIds),
    gte(callCallbacksTable.createdAt, from),
    lte(callCallbacksTable.createdAt, to),
  ));

  // Avg call duration via call_executions → calls
  const [durStats] = await db.select({
    avgDuration: sql<number>`avg(${callsTable.durationSeconds}) filter (where ${callsTable.durationSeconds} is not null)::int`,
  }).from(callExecutionsTable)
    .innerJoin(callsTable, eq(callExecutionsTable.callId, callsTable.id))
    .where(and(
      inArray(callExecutionsTable.campaignId, campaignIds),
      gte(callExecutionsTable.createdAt, from),
      lte(callExecutionsTable.createdAt, to),
      isNotNull(callExecutionsTable.callId),
    ));

  // Daily trend from batch_daily_metrics aggregated by date
  const dailyTrend = await db.select({
    date:        batchDailyMetricsTable.date,
    connected:   sql<number>`sum(${batchDailyMetricsTable.connected})::int`,
    booked:      sql<number>`sum(${batchDailyMetricsTable.booked})::int`,
    transferred: sql<number>`sum(${batchDailyMetricsTable.transferred})::int`,
    failed:      sql<number>`sum(${batchDailyMetricsTable.failed})::int`,
    callbacks:   sql<number>`sum(${batchDailyMetricsTable.callbacks})::int`,
  }).from(batchDailyMetricsTable)
    .innerJoin(campaignBatchesTable, eq(batchDailyMetricsTable.batchId, campaignBatchesTable.id))
    .where(and(
      inArray(campaignBatchesTable.campaignId, campaignIds),
      gte(batchDailyMetricsTable.date, from.toISOString().slice(0, 10)),
      lte(batchDailyMetricsTable.date, to.toISOString().slice(0, 10)),
    ))
    .groupBy(batchDailyMetricsTable.date)
    .orderBy(batchDailyMetricsTable.date);

  const total       = leadStats?.total       ?? 0;
  const called      = leadStats?.called      ?? 0;
  const connected   = leadStats?.connected   ?? 0;
  const booked      = leadStats?.booked      ?? 0;
  const transferred = leadStats?.transferred ?? 0;
  const cbTotal     = cbStats?.total         ?? 0;
  const cbCompleted = cbStats?.completed     ?? 0;

  res.json({
    totalLeads:          total,
    called,
    connected,
    interested:          leadStats?.interested ?? 0,
    booked,
    transferred,
    connectionRate:      called > 0 ? Math.round((connected   / called) * 100) : 0,
    bookingRate:         called > 0 ? Math.round((booked      / called) * 100) : 0,
    transferRate:        called > 0 ? Math.round((transferred / called) * 100) : 0,
    callbackSuccessRate: cbTotal > 0 ? Math.round((cbCompleted / cbTotal) * 100) : 0,
    avgDurationSeconds:  durStats?.avgDuration ?? 0,
    dailyTrend,
  });
});

// ── GET /api/platform/analytics/funnel ───────────────────────────────────────
router.get("/platform/analytics/funnel", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { from, to } = parseDateRange(req.query as Record<string, unknown>);
  const q = req.query as Record<string, string | undefined>;
  const filterCampaignId = q["campaignId"] ? parseInt(q["campaignId"]) : null;
  const filterBatchId    = q["batchId"]    ? parseInt(q["batchId"])    : null;
  const filterSourceId   = q["sourceId"]   ? parseInt(q["sourceId"])   : null;

  const campaignIds = await getCampaignIds(userId);
  if (campaignIds.length === 0) {
    res.json({ funnel: [], filters: { campaigns: [], sources: [] } });
    return;
  }

  const activeCampaignIds = filterCampaignId
    ? (campaignIds.includes(filterCampaignId) ? [filterCampaignId] : [])
    : campaignIds;
  if (activeCampaignIds.length === 0) { res.json({ funnel: [], filters: { campaigns: [], sources: [] } }); return; }

  const conditions = [
    inArray(campaignLeadsTable.campaignId, activeCampaignIds),
    gte(campaignLeadsTable.createdAt, from),
    lte(campaignLeadsTable.createdAt, to),
    ...(filterBatchId  ? [eq(campaignLeadsTable.batchId, filterBatchId)]       : []),
    ...(filterSourceId ? [eq(campaignLeadsTable.leadSourceId, filterSourceId)] : []),
  ];

  const [stats] = await db.select({
    total:       sql<number>`count(*)::int`,
    called:      sql<number>`count(*) filter (where call_attempts > 0)::int`,
    connected:   sql<number>`count(*) filter (where operational_outcome not in ('pending','no_pickup','failed','dnc'))::int`,
    interested:  sql<number>`count(*) filter (where operational_outcome in ('interested','booked','transferred','callback'))::int`,
    booked:      sql<number>`count(*) filter (where operational_outcome = 'booked')::int`,
    transferred: sql<number>`count(*) filter (where operational_outcome = 'transferred')::int`,
  }).from(campaignLeadsTable).where(and(...conditions));

  const total       = stats?.total       ?? 0;
  const called      = stats?.called      ?? 0;
  const connected   = stats?.connected   ?? 0;
  const interested  = stats?.interested  ?? 0;
  const booked      = stats?.booked      ?? 0;
  const transferred = stats?.transferred ?? 0;

  function pct(n: number, base: number) { return base > 0 ? Math.round((n / base) * 100) : 0; }
  function drop(a: number, b: number) { return a > 0 ? Math.round(((a - b) / a) * 100) : 0; }

  const funnel = [
    { stage: "Imported",    count: total,       pct: 100,                dropoff: drop(total, called) },
    { stage: "Called",      count: called,      pct: pct(called, total),      dropoff: drop(called, connected) },
    { stage: "Connected",   count: connected,   pct: pct(connected, total),   dropoff: drop(connected, interested) },
    { stage: "Interested",  count: interested,  pct: pct(interested, total),  dropoff: drop(interested, booked) },
    { stage: "Booked",      count: booked,      pct: pct(booked, total),      dropoff: drop(booked, transferred) },
    { stage: "Transferred", count: transferred, pct: pct(transferred, total), dropoff: 0 },
  ];

  // Filter options
  const campaigns = await db.select({ id: campaignsTable.id, name: campaignsTable.name })
    .from(campaignsTable).where(eq(campaignsTable.userId, userId))
    .orderBy(desc(campaignsTable.createdAt)).limit(50);

  const sources = await db.select({ id: leadSourcesTable.id, name: leadSourcesTable.sourceName, type: leadSourcesTable.sourceType })
    .from(leadSourcesTable).where(eq(leadSourcesTable.userId, userId))
    .orderBy(desc(leadSourcesTable.createdAt)).limit(50);

  res.json({ funnel, filters: { campaigns, sources } });
});

// ── GET /api/platform/analytics/sources ──────────────────────────────────────
router.get("/platform/analytics/sources", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { from, to } = parseDateRange(req.query as Record<string, unknown>);
  const campaignIds  = await getCampaignIds(userId);
  if (campaignIds.length === 0) { res.json([]); return; }

  const rows = await db.select({
    sourceId:    campaignLeadsTable.leadSourceId,
    sourceName:  leadSourcesTable.sourceName,
    sourceType:  leadSourcesTable.sourceType,
    total:       sql<number>`count(*)::int`,
    called:      sql<number>`count(*) filter (where call_attempts > 0)::int`,
    connected:   sql<number>`count(*) filter (where operational_outcome not in ('pending','no_pickup','failed','dnc'))::int`,
    booked:      sql<number>`count(*) filter (where operational_outcome = 'booked')::int`,
    transferred: sql<number>`count(*) filter (where operational_outcome = 'transferred')::int`,
  }).from(campaignLeadsTable)
    .leftJoin(leadSourcesTable, eq(campaignLeadsTable.leadSourceId, leadSourcesTable.id))
    .where(and(
      inArray(campaignLeadsTable.campaignId, campaignIds),
      gte(campaignLeadsTable.createdAt, from),
      lte(campaignLeadsTable.createdAt, to),
    ))
    .groupBy(campaignLeadsTable.leadSourceId, leadSourcesTable.sourceName, leadSourcesTable.sourceType)
    .orderBy(sql`count(*) desc`);

  res.json(rows.map(r => ({
    sourceId:       r.sourceId,
    sourceName:     (r.sourceName as string | null) ?? "Direct / Unknown",
    sourceType:     (r.sourceType as string | null) ?? "unknown",
    total:          r.total,
    called:         r.called,
    connected:      r.connected,
    booked:         r.booked,
    transferred:    r.transferred,
    connectionRate: r.called > 0 ? Math.round((r.connected   / r.called) * 100) : 0,
    bookingRate:    r.called > 0 ? Math.round((r.booked      / r.called) * 100) : 0,
    transferRate:   r.called > 0 ? Math.round((r.transferred / r.called) * 100) : 0,
  })));
});

// ── GET /api/platform/analytics/campaigns ────────────────────────────────────
router.get("/platform/analytics/campaigns", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { from, to } = parseDateRange(req.query as Record<string, unknown>);
  const campaignIds  = await getCampaignIds(userId);
  if (campaignIds.length === 0) { res.json([]); return; }

  const rows = await db.select({
    campaignId:   campaignLeadsTable.campaignId,
    campaignName: campaignsTable.name,
    agentId:      campaignsTable.agentId,
    agentName:    agentsTable.name,
    total:        sql<number>`count(*)::int`,
    called:       sql<number>`count(*) filter (where call_attempts > 0)::int`,
    connected:    sql<number>`count(*) filter (where operational_outcome not in ('pending','no_pickup','failed','dnc'))::int`,
    booked:       sql<number>`count(*) filter (where operational_outcome = 'booked')::int`,
    transferred:  sql<number>`count(*) filter (where operational_outcome = 'transferred')::int`,
  }).from(campaignLeadsTable)
    .innerJoin(campaignsTable,  eq(campaignLeadsTable.campaignId, campaignsTable.id))
    .leftJoin(agentsTable, eq(campaignsTable.agentId, agentsTable.id))
    .where(and(
      inArray(campaignLeadsTable.campaignId, campaignIds),
      gte(campaignLeadsTable.createdAt, from),
      lte(campaignLeadsTable.createdAt, to),
    ))
    .groupBy(
      campaignLeadsTable.campaignId, campaignsTable.name,
      campaignsTable.agentId, agentsTable.name,
    )
    .orderBy(sql`count(*) desc`);

  res.json(rows.map(r => ({
    campaignId:     r.campaignId,
    campaignName:   r.campaignName,
    agentName:      r.agentName ?? null,
    total:          r.total,
    called:         r.called,
    connected:      r.connected,
    booked:         r.booked,
    transferred:    r.transferred,
    successRate:    r.called > 0 ? Math.round(((r.booked + r.transferred) / r.called) * 100) : 0,
    connectionRate: r.called > 0 ? Math.round((r.connected / r.called) * 100) : 0,
  })));
});

// ── GET /api/platform/analytics/agents ───────────────────────────────────────
router.get("/platform/analytics/agents", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { from, to } = parseDateRange(req.query as Record<string, unknown>);
  const campaignIds  = await getCampaignIds(userId);
  if (campaignIds.length === 0) { res.json([]); return; }

  const rows = await db.select({
    agentId:      campaignsTable.agentId,
    agentName:    agentsTable.name,
    total:        sql<number>`count(*)::int`,
    called:       sql<number>`count(*) filter (where call_attempts > 0)::int`,
    connected:    sql<number>`count(*) filter (where operational_outcome not in ('pending','no_pickup','failed','dnc'))::int`,
    booked:       sql<number>`count(*) filter (where operational_outcome = 'booked')::int`,
    transferred:  sql<number>`count(*) filter (where operational_outcome = 'transferred')::int`,
  }).from(campaignLeadsTable)
    .innerJoin(campaignsTable, eq(campaignLeadsTable.campaignId, campaignsTable.id))
    .leftJoin(agentsTable, eq(campaignsTable.agentId, agentsTable.id))
    .where(and(
      inArray(campaignLeadsTable.campaignId, campaignIds),
      isNotNull(campaignsTable.agentId),
      gte(campaignLeadsTable.createdAt, from),
      lte(campaignLeadsTable.createdAt, to),
    ))
    .groupBy(campaignsTable.agentId, agentsTable.name)
    .orderBy(sql`count(*) filter (where operational_outcome in ('booked','transferred')) desc`);

  // Avg duration per agent via call_executions → calls
  const durRows = await db.select({
    agentId:     campaignsTable.agentId,
    avgDuration: sql<number>`avg(${callsTable.durationSeconds}) filter (where ${callsTable.durationSeconds} is not null)::int`,
  }).from(callExecutionsTable)
    .innerJoin(campaignsTable, eq(callExecutionsTable.campaignId, campaignsTable.id))
    .innerJoin(callsTable, eq(callExecutionsTable.callId, callsTable.id))
    .where(and(
      inArray(callExecutionsTable.campaignId, campaignIds),
      isNotNull(campaignsTable.agentId),
      gte(callExecutionsTable.createdAt, from),
      lte(callExecutionsTable.createdAt, to),
    ))
    .groupBy(campaignsTable.agentId);

  const durMap = new Map(durRows.map(r => [r.agentId, r.avgDuration]));

  // Sentiment distribution per agent
  const sentRows = await db.select({
    agentId:   campaignsTable.agentId,
    sentiment: callExecutionsTable.sentiment,
    cnt:       sql<number>`count(*)::int`,
  }).from(callExecutionsTable)
    .innerJoin(campaignsTable, eq(callExecutionsTable.campaignId, campaignsTable.id))
    .where(and(
      inArray(callExecutionsTable.campaignId, campaignIds),
      isNotNull(campaignsTable.agentId),
      isNotNull(callExecutionsTable.sentiment),
      gte(callExecutionsTable.createdAt, from),
      lte(callExecutionsTable.createdAt, to),
    ))
    .groupBy(campaignsTable.agentId, callExecutionsTable.sentiment);

  const sentMap = new Map<number | null, Record<string, number>>();
  for (const r of sentRows) {
    if (!sentMap.has(r.agentId)) sentMap.set(r.agentId, {});
    sentMap.get(r.agentId)![r.sentiment ?? "unknown"] = r.cnt;
  }

  res.json(rows.map(r => ({
    agentId:          r.agentId,
    agentName:        r.agentName ?? "Unknown Agent",
    total:            r.total,
    called:           r.called,
    connected:        r.connected,
    booked:           r.booked,
    transferred:      r.transferred,
    connectionRate:   r.called > 0 ? Math.round((r.connected   / r.called) * 100) : 0,
    bookingRate:      r.called > 0 ? Math.round((r.booked      / r.called) * 100) : 0,
    transferRate:     r.called > 0 ? Math.round((r.transferred / r.called) * 100) : 0,
    avgDurationSeconds: durMap.get(r.agentId) ?? null,
    sentimentBreakdown: sentMap.get(r.agentId) ?? {},
  })));
});

// ── GET /api/platform/analytics/queue ────────────────────────────────────────
router.get("/platform/analytics/queue", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const now = new Date();
  const campaignIds = await getCampaignIds(userId);

  if (campaignIds.length === 0) {
    res.json({
      callbacks:  { total: 0, pending: 0, completed: 0, cancelled: 0, missed: 0, overdue: 0 },
      bookings:   { total: 0, scheduled: 0, completed: 0, cancelled: 0 },
      transfers:  { total: 0, initiated: 0, connected: 0, completed: 0, failed: 0 },
    });
    return;
  }

  // Callbacks
  const [cbStats] = await db.select({
    total:     sql<number>`count(*)::int`,
    pending:   sql<number>`count(*) filter (where status = 'pending')::int`,
    completed: sql<number>`count(*) filter (where status = 'completed')::int`,
    cancelled: sql<number>`count(*) filter (where status = 'cancelled')::int`,
    missed:    sql<number>`count(*) filter (where status = 'missed')::int`,
    overdue:   sql<number>`count(*) filter (where status = 'pending' and response_due_by < now())::int`,
  }).from(callCallbacksTable)
    .where(inArray(callCallbacksTable.campaignId, campaignIds));

  // Bookings
  const [bkStats] = await db.select({
    total:     sql<number>`count(*)::int`,
    scheduled: sql<number>`count(*) filter (where meeting_status = 'scheduled')::int`,
    completed: sql<number>`count(*) filter (where meeting_status = 'completed')::int`,
    cancelled: sql<number>`count(*) filter (where meeting_status = 'cancelled')::int`,
  }).from(callBookingsTable)
    .where(inArray(callBookingsTable.campaignId, campaignIds));

  // Transfers — filtered by userId directly
  const [trStats] = await db.select({
    total:     sql<number>`count(*)::int`,
    initiated: sql<number>`count(*) filter (where status = 'initiated')::int`,
    connected: sql<number>`count(*) filter (where status = 'connected')::int`,
    completed: sql<number>`count(*) filter (where status = 'completed')::int`,
    failed:    sql<number>`count(*) filter (where status = 'failed')::int`,
  }).from(callTransfersTable)
    .where(eq(callTransfersTable.userId, userId));

  res.json({
    callbacks: {
      total:     cbStats?.total     ?? 0,
      pending:   cbStats?.pending   ?? 0,
      completed: cbStats?.completed ?? 0,
      cancelled: cbStats?.cancelled ?? 0,
      missed:    cbStats?.missed    ?? 0,
      overdue:   cbStats?.overdue   ?? 0,
    },
    bookings: {
      total:     bkStats?.total     ?? 0,
      scheduled: bkStats?.scheduled ?? 0,
      completed: bkStats?.completed ?? 0,
      cancelled: bkStats?.cancelled ?? 0,
    },
    transfers: {
      total:     trStats?.total     ?? 0,
      initiated: trStats?.initiated ?? 0,
      connected: trStats?.connected ?? 0,
      completed: trStats?.completed ?? 0,
      failed:    trStats?.failed    ?? 0,
    },
    generatedAt: now.toISOString(),
  });
});

// ── GET /api/platform/analytics/batches/:batchId ─────────────────────────────
router.get("/platform/analytics/batches/:batchId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const batchId = parseInt(req.params["batchId"]!, 10);
  if (isNaN(batchId)) { res.status(400).json({ error: "Invalid batchId" }); return; }

  const [batch] = await db.select({
    id:           campaignBatchesTable.id,
    name:         campaignBatchesTable.name,
    status:       campaignBatchesTable.status,
    campaignId:   campaignBatchesTable.campaignId,
    campaignName: campaignsTable.name,
    totalLeads:   campaignBatchesTable.totalLeads,
  }).from(campaignBatchesTable)
    .innerJoin(campaignsTable, eq(campaignBatchesTable.campaignId, campaignsTable.id))
    .where(and(eq(campaignBatchesTable.id, batchId), eq(campaignsTable.userId, userId)));

  if (!batch) { res.status(404).json({ error: "Not found" }); return; }

  // Outcome totals from campaign_leads
  const [totals] = await db.select({
    total:       sql<number>`count(*)::int`,
    called:      sql<number>`count(*) filter (where call_attempts > 0)::int`,
    connected:   sql<number>`count(*) filter (where operational_outcome not in ('pending','no_pickup','failed','dnc'))::int`,
    interested:  sql<number>`count(*) filter (where operational_outcome in ('interested','booked','transferred','callback'))::int`,
    booked:      sql<number>`count(*) filter (where operational_outcome = 'booked')::int`,
    transferred: sql<number>`count(*) filter (where operational_outcome = 'transferred')::int`,
    failed:      sql<number>`count(*) filter (where operational_outcome in ('failed','no_pickup','dnc'))::int`,
    pending:     sql<number>`count(*) filter (where operational_outcome = 'pending')::int`,
  }).from(campaignLeadsTable)
    .where(eq(campaignLeadsTable.batchId, batchId));

  // Daily trend
  const dailyTrend = await db.select({
    date:        batchDailyMetricsTable.date,
    connected:   batchDailyMetricsTable.connected,
    booked:      batchDailyMetricsTable.booked,
    transferred: batchDailyMetricsTable.transferred,
    failed:      batchDailyMetricsTable.failed,
    callbacks:   batchDailyMetricsTable.callbacks,
  }).from(batchDailyMetricsTable)
    .where(eq(batchDailyMetricsTable.batchId, batchId))
    .orderBy(batchDailyMetricsTable.date);

  res.json({
    batch: {
      id:           batch.id,
      name:         batch.name,
      status:       batch.status,
      campaignId:   batch.campaignId,
      campaignName: batch.campaignName,
      totalLeads:   batch.totalLeads,
    },
    totals: {
      total:       totals?.total       ?? 0,
      called:      totals?.called      ?? 0,
      connected:   totals?.connected   ?? 0,
      interested:  totals?.interested  ?? 0,
      booked:      totals?.booked      ?? 0,
      transferred: totals?.transferred ?? 0,
      failed:      totals?.failed      ?? 0,
      pending:     totals?.pending     ?? 0,
    },
    dailyTrend,
  });
});

export default router;

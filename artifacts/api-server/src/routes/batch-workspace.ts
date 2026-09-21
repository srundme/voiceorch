/**
 * Batch Workspace — Phase 4
 * ─────────────────────────────────────────────────────────────────────────────
 * Transforms a batch from an "import container" into an Operational Command Center.
 * Five focused read endpoints — controls (start/pause/stop/redial) stay in existing routes.
 */

import { Router, type IRouter } from "express";
import { getAuth } from "../lib/auth-compat.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext } from "../middlewares/clientContext.js";
import {
  db,
  campaignsTable, campaignBatchesTable, campaignLeadsTable,
  callExecutionsTable, callCallbacksTable, callBookingsTable,
  incomingCallsTable, callTransfersTable, leadTimelineTable,
  batchImportRunsTable, leadSourcesTable,
  agentsTable, callRetriesTable, callsTable, scheduledCallbacksTable,
  agentDispositionsTable,
} from "@workspace/db";
import { eq, and, sql, desc, isNotNull, inArray, asc, or, ilike } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import {
  campaignConfiguredDispositionFilterSql,
  campaignHasConfiguredDispositionSql,
  campaignReportingKpiSelect,
  summarizeConfiguredDispositionHero,
  type CampaignDispositionTaxonomy,
} from "../services/campaign-lead-reporting.js";

const router: IRouter = Router();

router.use(requireAuth, clientContext);

/** Aggregate queries always return one row; never assume destructure [0] exists. */
function aggCount(rows: Array<{ [k: string]: number } | undefined> | undefined, key: string): number {
  const row = rows?.[0];
  const n = row?.[key];
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

async function requireBatch(campaignId: number, batchId: number, userId: string) {
  const [campaign] = await db.select({ id: campaignsTable.id })
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
  if (!campaign) return null;

  const [batch] = await db.select()
    .from(campaignBatchesTable)
    .where(and(eq(campaignBatchesTable.id, batchId), eq(campaignBatchesTable.campaignId, campaignId)));
  return batch ?? null;
}

async function loadAgentDispositionTaxonomy(agentId: number | null): Promise<CampaignDispositionTaxonomy> {
  if (agentId == null) return {};
  const [row] = await db.select({ taxonomy: agentDispositionsTable.taxonomy })
    .from(agentDispositionsTable)
    .where(eq(agentDispositionsTable.agentId, agentId))
    .limit(1);
  return row?.taxonomy && typeof row.taxonomy === "object" && !Array.isArray(row.taxonomy)
    ? row.taxonomy as CampaignDispositionTaxonomy
    : {};
}

async function loadCampaignDispositionTaxonomy(campaignId: number): Promise<CampaignDispositionTaxonomy> {
  const [campaign] = await db.select({ agentId: campaignsTable.agentId })
    .from(campaignsTable)
    .where(eq(campaignsTable.id, campaignId))
    .limit(1);
  return loadAgentDispositionTaxonomy(campaign?.agentId ?? null);
}

// ── GET /campaigns/:id/batches/:batchId/workspace/kpis ────────────────────────

router.get("/campaigns/:id/batches/:batchId/workspace/kpis", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const batchId    = parseInt(req.params["batchId"]!, 10);
  if (isNaN(campaignId) || isNaN(batchId)) {
    res.status(404).json({ error: "Not found" }); return;
  }
  const batch = await requireBatch(campaignId, batchId, userId);
  if (!batch) { res.status(404).json({ error: "Not found" }); return; }

  // Campaign for agent name
  const [campaign] = await db.select({ agentId: campaignsTable.agentId })
    .from(campaignsTable).where(eq(campaignsTable.id, campaignId));
  const agentRow = campaign?.agentId
    ? (await db.select({ name: agentsTable.name }).from(agentsTable).where(eq(agentsTable.id, campaign.agentId)))[0]
    : null;
  const agentName = agentRow?.name ?? null;

  const [leadKpis] = await db.select(campaignReportingKpiSelect())
    .from(campaignLeadsTable)
    .where(eq(campaignLeadsTable.batchId, batchId));

  // Secondary counters are best-effort. A failure here used to 500 the whole
  // handler so Call Outcomes rendered "—" while the leads table (separate
  // endpoint) still showed hundreds of rows.
  let callbacks = 0;
  let incoming = 0;
  let bookings = 0;
  let transfers = 0;
  let costDuration: { avgDurationS: number | null; totalCostCents: number } | undefined;
  let lastActivity: { lastAt: string | null } | undefined;
  let dispositions: { key: string; count: number }[] = [];

  try {
    // Callbacks. Two tables record them: callCallbacks (transcript detector +
    // manual) and scheduledCallbacks (the schedule_callback tool). Counting only
    // the first showed 0 for batches full of callback dispositions, so count
    // distinct leads across both.
    const callbackRows = await db.select({
      callbacks: sql<number>`count(distinct ${campaignLeadsTable.id})::int`,
    }).from(campaignLeadsTable)
      .where(and(
        eq(campaignLeadsTable.batchId, batchId),
        or(
          sql`exists (select 1 from ${callCallbacksTable} where ${callCallbacksTable.leadId} = ${campaignLeadsTable.id})`,
          sql`exists (select 1 from ${scheduledCallbacksTable} where ${scheduledCallbacksTable.campaignLeadId} = ${campaignLeadsTable.id})`,
        ),
      ));
    callbacks = aggCount(callbackRows, "callbacks");

    const incomingRows = await db.select({
      incoming: sql<number>`count(*)::int`,
    }).from(incomingCallsTable)
      .where(eq(incomingCallsTable.batchId, batchId));
    incoming = aggCount(incomingRows, "incoming");

    const bookingRows = await db.select({
      bookings: sql<number>`count(*)::int`,
    }).from(callBookingsTable)
      .where(eq(callBookingsTable.batchId, batchId));
    bookings = aggCount(bookingRows, "bookings");

    const transferRows = await db.select({
      transfers: sql<number>`count(distinct ${callTransfersTable.id})::int`,
    }).from(callTransfersTable)
      .innerJoin(callExecutionsTable,
        and(
          eq(callTransfersTable.callId, callExecutionsTable.callId!),
          eq(callExecutionsTable.batchId, batchId),
          isNotNull(callExecutionsTable.callId),
        )!,
      );
    transfers = aggCount(transferRows, "transfers");

    [costDuration] = await db.select({
      avgDurationS:   sql<number | null>`round(avg(${callsTable.durationSeconds}))::int`,
      totalCostCents: sql<number>`coalesce(sum(${callsTable.costCents}),0)::int`,
    }).from(campaignLeadsTable)
      .innerJoin(
        callsTable,
        and(eq(campaignLeadsTable.callId, callsTable.id), isNotNull(campaignLeadsTable.callId))!,
      )
      .where(eq(campaignLeadsTable.batchId, batchId));

    [lastActivity] = await db.select({
      lastAt: sql<string | null>`max(last_attempt_at)::text`,
    }).from(campaignLeadsTable)
      .where(and(eq(campaignLeadsTable.batchId, batchId), isNotNull(campaignLeadsTable.lastAttemptAt)));
  } catch (err) {
    logger.warn({ err, campaignId, batchId }, "batch workspace KPIs: secondary counters failed — returning lead funnel only");
  }

  try {
    // Business dispositions only. Carrier outcomes have dedicated KPI fields.
    const dispositionRows = await db.select({
      answeredEver: campaignLeadsTable.answeredEver,
      disposition: campaignLeadsTable.disposition,
      lastAttemptStatus: campaignLeadsTable.lastAttemptStatus,
      callStatus: campaignLeadsTable.callStatus,
      count: sql<number>`count(*)::int`,
    }).from(campaignLeadsTable)
      .where(eq(campaignLeadsTable.batchId, batchId))
      .groupBy(
        campaignLeadsTable.answeredEver,
        campaignLeadsTable.disposition,
        campaignLeadsTable.lastAttemptStatus,
        campaignLeadsTable.callStatus,
      );

    // The agent taxonomy is the only source of business-outcome cards. Unknown
    // historical/provider values are review work, never new ad-hoc categories.
    const taxonomyObj = await loadAgentDispositionTaxonomy(campaign?.agentId ?? null);
    dispositions = summarizeConfiguredDispositionHero(dispositionRows, taxonomyObj)
      .map((item) => ({ key: item.key, count: item.count }));
  } catch (err) {
    logger.warn({ err, campaignId, batchId }, "batch workspace KPIs: disposition rollup failed — core funnel still returned");
  }

  const total        = leadKpis?.imported     ?? 0;
  const called       = leadKpis?.attempted    ?? 0;
  const successCount = leadKpis?.interested   ?? 0;
  const successRate  = called > 0 ? Math.round((successCount / called) * 100) : 0;

  // Estimated Time Remaining (pace-based)
  // Rate = calls made per minute since first attempt; ETR = pending / rate
  let estimatedTimeRemainingMins: number | null = null;
  const firstAttemptAt = leadKpis?.firstAttemptAt;
  if (firstAttemptAt && called > 0) {
    const elapsedMins = (Date.now() - new Date(firstAttemptAt).getTime()) / 60_000;
    const ratePerMin = elapsedMins > 0 ? called / elapsedMins : 0;
    const remaining = total - called;
    if (ratePerMin > 0 && remaining > 0) {
      estimatedTimeRemainingMins = Math.round(remaining / ratePerMin);
    }
  }

  res.json({
    total,
    called,
    connected:        leadKpis?.answered    ?? 0,
    interested:       leadKpis?.interested  ?? 0,
    booked:           leadKpis?.booked      ?? 0,
    transferred:      leadKpis?.transferred ?? 0,
    failed:           leadKpis?.technicalFailed ?? 0,
    busy:             leadKpis?.busy        ?? 0,
    noPickup:         leadKpis?.noPickup    ?? 0,
    voicemail:        leadKpis?.voicemail   ?? 0,
    pending:          leadKpis?.queued      ?? 0,
    callbacks,
    incoming,
    bookings,
    transfers,
    successRate,
    dispositions,
    undispositioned: leadKpis?.dispositionNeedsClassification ?? 0,
    lastActivityAt:             lastActivity?.lastAt ?? null,
    avgCallDurationS:           costDuration?.avgDurationS ?? null,
    totalCostCents:             costDuration?.totalCostCents ?? 0,
    agentName,
    estimatedTimeRemainingMins,
  });
});

// ── GET /campaigns/:id/batches/:batchId/workspace/funnel ──────────────────────

router.get("/campaigns/:id/batches/:batchId/workspace/funnel", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const batchId    = parseInt(req.params["batchId"]!, 10);
  if (isNaN(campaignId) || isNaN(batchId) || !await requireBatch(campaignId, batchId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const [r] = await db.select(campaignReportingKpiSelect())
    .from(campaignLeadsTable).where(eq(campaignLeadsTable.batchId, batchId));

  res.json({
    stages: [
      { key: "imported",    label: "Imported",    value: r?.imported    ?? 0 },
      { key: "called",      label: "Called",       value: r?.attempted   ?? 0 },
      { key: "connected",   label: "Answered",     value: r?.answered    ?? 0 },
      { key: "interested",  label: "Interested",   value: r?.interested  ?? 0 },
      { key: "booked",      label: "Booked",       value: r?.booked      ?? 0 },
      { key: "transferred", label: "Transferred",  value: r?.transferred ?? 0 },
    ],
    total: r?.imported ?? 0,
  });
});

// ── GET /campaigns/:id/batches/:batchId/workspace/leads ───────────────────────

router.get("/campaigns/:id/batches/:batchId/workspace/leads", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const batchId    = parseInt(req.params["batchId"]!, 10);
  if (isNaN(campaignId) || isNaN(batchId) || !await requireBatch(campaignId, batchId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const page  = Math.max(0, parseInt(String(req.query["page"]  ?? "0"), 10) || 0);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query["limit"] ?? "50"), 10) || 50));
  const status = String(req.query["status"] ?? "all");
  const outcome = String(req.query["outcome"] ?? "all");
  const search = String(req.query["search"] ?? "").trim();
  const dispositionTaxonomy = await loadCampaignDispositionTaxonomy(campaignId);

  const baseWhere = and(
    eq(campaignLeadsTable.campaignId, campaignId),
    eq(campaignLeadsTable.batchId!, batchId),
  )!;

  const statusFilter =
    status === "pending"   ? eq(campaignLeadsTable.callStatus, "pending")   :
    status === "completed" ? eq(campaignLeadsTable.callStatus, "completed") :
    status === "voicemail" ? eq(campaignLeadsTable.callStatus, "voicemail") :
    status === "failed"    ? eq(campaignLeadsTable.callStatus, "failed")    :
    status === "busy"      ? eq(campaignLeadsTable.callStatus, "busy")      :
    status === "no_pickup" ? eq(campaignLeadsTable.callStatus, "no_pickup") :
    status === "calling"   ? eq(campaignLeadsTable.callStatus, "calling")   :
    status === "connected" ? inArray(campaignLeadsTable.callStatus, ["connected", "completed", "transferred"]) :
    undefined;

  const outcomeFilter =
    outcome === "all"                ? undefined :
    outcome === "booking_created"    ? and(eq(campaignLeadsTable.answeredEver, true), eq(campaignLeadsTable.operationalOutcome, "booking_created"))    :
    outcome === "transfer_completed" ? and(eq(campaignLeadsTable.answeredEver, true), eq(campaignLeadsTable.operationalOutcome, "transfer_completed")) :
    outcome === "callback_requested" ? and(eq(campaignLeadsTable.answeredEver, true), eq(campaignLeadsTable.operationalOutcome, "callback_requested")) :
    outcome === "__undispositioned__" || outcome === "needs_classification"
      ? and(
          sql`${campaignLeadsTable.answeredEver} is true`,
          sql`not (${campaignHasConfiguredDispositionSql(dispositionTaxonomy)})`,
        )
      : and(
          eq(campaignLeadsTable.answeredEver, true),
          campaignConfiguredDispositionFilterSql(outcome, dispositionTaxonomy),
        );

  const searchFilter = search
    ? or(
        ilike(campaignLeadsTable.name, `%${search}%`),
        ilike(campaignLeadsTable.phone, `%${search}%`),
      )
    : undefined;

  const where = and(baseWhere, statusFilter, outcomeFilter, searchFilter)!;

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(campaignLeadsTable).where(where);

  const leads = await db.select({
    id:                 campaignLeadsTable.id,
    name:               campaignLeadsTable.name,
    phone:              campaignLeadsTable.phone,
    callStatus:         campaignLeadsTable.callStatus,
    operationalOutcome: campaignLeadsTable.operationalOutcome,
    disposition:        campaignLeadsTable.disposition,
    callAttempts:       campaignLeadsTable.callAttempts,
    lastAttemptAt:      campaignLeadsTable.lastAttemptAt,
    callId:             campaignLeadsTable.callId,
    notes:              campaignLeadsTable.notes,
    createdAt:          campaignLeadsTable.createdAt,
    nextRetryAt:        sql<string | null>`(
      select min(t.scheduled_at) from (
        select scheduled_at from call_retries
        where lead_id = ${campaignLeadsTable.id} and status = 'pending'
        union all
        select scheduled_at from scheduled_callbacks
        where campaign_lead_id = ${campaignLeadsTable.id} and status = 'pending'
      ) t
    )`,
  }).from(campaignLeadsTable)
    .where(where)
    .orderBy(desc(campaignLeadsTable.lastAttemptAt), desc(campaignLeadsTable.createdAt))
    .limit(limit)
    .offset(page * limit);

  if (leads.length === 0) {
    res.json({ items: [], total, page, limit }); return;
  }

  const leadIds = leads.map(l => l.id);

  // Batch-load related records (including call stats for duration/cost)
  const callIds = leads.filter(l => l.callId).map(l => l.callId!);
  const callStatsMap = new Map<number, { durationSeconds: number | null; costCents: number | null; executionId: string | null }>();
  if (callIds.length > 0) {
    const callRows = await db.select({ id: callsTable.id, durationSeconds: callsTable.durationSeconds, costCents: callsTable.costCents, executionId: callsTable.executionId })
      .from(callsTable).where(inArray(callsTable.id, callIds));
    for (const r of callRows) callStatsMap.set(r.id, { durationSeconds: r.durationSeconds ?? null, costCents: r.costCents ?? null, executionId: r.executionId ?? null });
  }

  const [callbacks, bookings, transfers] = await Promise.all([
    db.select({
      leadId: callCallbacksTable.leadId,
      status: callCallbacksTable.status,
      callbackAt: callCallbacksTable.callbackAt,
    }).from(callCallbacksTable)
      .where(inArray(callCallbacksTable.leadId, leadIds))
      .orderBy(desc(callCallbacksTable.createdAt)),

    db.select({
      leadId: callBookingsTable.leadId,
      meetingTime: callBookingsTable.meetingTime,
      meetingStatus: callBookingsTable.meetingStatus,
      meetingLink: callBookingsTable.meetingLink,
    }).from(callBookingsTable)
      .where(inArray(callBookingsTable.leadId, leadIds))
      .orderBy(desc(callBookingsTable.createdAt)),

    db.selectDistinctOn([callTransfersTable.id], {
      callId: callTransfersTable.callId,
      status: callTransfersTable.status,
      transferTo: callTransfersTable.transferTo,
      leadId: callExecutionsTable.leadId,
    }).from(callTransfersTable)
      .innerJoin(callExecutionsTable,
        and(
          eq(callTransfersTable.callId, callExecutionsTable.callId!),
          eq(callExecutionsTable.batchId, batchId),
          isNotNull(callExecutionsTable.callId),
          inArray(callExecutionsTable.leadId, leadIds),
        )!,
      )
      .orderBy(callTransfersTable.id, desc(callTransfersTable.initiatedAt)),
  ]);

  const execRows = await db.select({
    leadId: callExecutionsTable.leadId,
    callId: callExecutionsTable.callId,
    attemptNumber: callExecutionsTable.attemptNumber,
    createdAt: callExecutionsTable.createdAt,
  }).from(callExecutionsTable)
    .where(and(
      inArray(callExecutionsTable.leadId, leadIds),
      isNotNull(callExecutionsTable.callId),
    ))
    .orderBy(asc(callExecutionsTable.attemptNumber), asc(callExecutionsTable.createdAt));

  const attemptsByLead = new Map<number, { attemptNumber: number; callId: number }[]>();
  for (const r of execRows) {
    if (r.callId == null) continue;
    const list = attemptsByLead.get(r.leadId) ?? [];
    if (list.some((a) => a.callId === r.callId)) continue;
    list.push({ attemptNumber: r.attemptNumber, callId: r.callId });
    attemptsByLead.set(r.leadId, list);
  }

  // Index by leadId (first match per lead)
  const callbackMap = new Map<number, typeof callbacks[0]>();
  const bookingMap  = new Map<number, typeof bookings[0]>();
  const transferMap = new Map<number, typeof transfers[0]>();
  for (const c of callbacks) if (!callbackMap.has(c.leadId)) callbackMap.set(c.leadId, c);
  for (const b of bookings)  if (!bookingMap.has(b.leadId))  bookingMap.set(b.leadId, b);
  for (const t of transfers) {
    const lid = t.leadId;
    if (lid != null && !transferMap.has(lid)) transferMap.set(lid, t);
  }

  const items = leads.map(l => ({
    ...l,
    lastAttemptAt:   l.lastAttemptAt?.toISOString() ?? null,
    nextRetryAt:     l.nextRetryAt ? new Date(l.nextRetryAt).toISOString() : null,
    createdAt:       l.createdAt.toISOString(),
    durationSeconds: l.callId ? (callStatsMap.get(l.callId)?.durationSeconds ?? null) : null,
    costCents:       l.callId ? (callStatsMap.get(l.callId)?.costCents ?? null) : null,
    executionId:     l.callId ? (callStatsMap.get(l.callId)?.executionId ?? null) : null,
    callback:  callbackMap.has(l.id) ? {
      status:     callbackMap.get(l.id)!.status,
      callbackAt: callbackMap.get(l.id)!.callbackAt?.toISOString() ?? null,
    } : null,
    booking: bookingMap.has(l.id) ? {
      meetingTime:   bookingMap.get(l.id)!.meetingTime?.toISOString() ?? null,
      meetingStatus: bookingMap.get(l.id)!.meetingStatus,
      meetingLink:   bookingMap.get(l.id)!.meetingLink ?? null,
    } : null,
    transfer: transferMap.has(l.id) ? {
      status:     transferMap.get(l.id)!.status,
      transferTo: transferMap.get(l.id)!.transferTo,
    } : null,
    attempts: (() => {
      const fromExec = attemptsByLead.get(l.id) ?? [];
      if (fromExec.length > 0) {
        if (l.callId && !fromExec.some((a) => a.callId === l.callId)) {
          fromExec.push({ attemptNumber: fromExec.length + 1, callId: l.callId });
        }
        return fromExec;
      }
      if (l.callId) return [{ attemptNumber: 1, callId: l.callId }];
      return [];
    })(),
  }));

  res.json({ items, total, page, limit });
});

// ── GET /campaigns/:id/batches/:batchId/workspace/activity ────────────────────

router.get("/campaigns/:id/batches/:batchId/workspace/activity", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const batchId    = parseInt(req.params["batchId"]!, 10);
  if (isNaN(campaignId) || isNaN(batchId) || !await requireBatch(campaignId, batchId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const limit = Math.min(200, Math.max(1, parseInt(String(req.query["limit"] ?? "100"), 10) || 100));

  // Get lead IDs for this batch
  const batchLeadIds = await db.select({ id: campaignLeadsTable.id })
    .from(campaignLeadsTable)
    .where(eq(campaignLeadsTable.batchId!, batchId));

  if (batchLeadIds.length === 0) {
    res.json({ events: [] }); return;
  }

  const leadIds = batchLeadIds.map(l => l.id);

  const events = await db.select({
    id:        leadTimelineTable.id,
    leadId:    leadTimelineTable.leadId,
    eventType: leadTimelineTable.eventType,
    data:      leadTimelineTable.data,
    createdAt: leadTimelineTable.createdAt,
  }).from(leadTimelineTable)
    .where(inArray(leadTimelineTable.leadId, leadIds))
    .orderBy(desc(leadTimelineTable.createdAt))
    .limit(limit);

  // Enrich with lead name for display
  const leadsById = new Map(batchLeadIds.map(l => [l.id, l]));

  // Get lead names for events
  const uniqueLeadIdsInEvents = [...new Set(events.map(e => e.leadId))];
  const leadNames = uniqueLeadIdsInEvents.length > 0
    ? await db.select({ id: campaignLeadsTable.id, name: campaignLeadsTable.name, phone: campaignLeadsTable.phone })
        .from(campaignLeadsTable)
        .where(inArray(campaignLeadsTable.id, uniqueLeadIdsInEvents))
    : [];
  const leadNameMap = new Map(leadNames.map(l => [l.id, { name: l.name, phone: l.phone }]));

  res.json({
    events: events.map(e => ({
      id:        e.id,
      leadId:    e.leadId,
      leadName:  leadNameMap.get(e.leadId)?.name  ?? null,
      leadPhone: leadNameMap.get(e.leadId)?.phone ?? null,
      eventType: e.eventType,
      data:      e.data,
      createdAt: e.createdAt.toISOString(),
    })),
  });
});

// ── GET /campaigns/:id/batches/:batchId/workspace/sources ─────────────────────

router.get("/campaigns/:id/batches/:batchId/workspace/sources", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const batchId    = parseInt(req.params["batchId"]!, 10);
  if (isNaN(campaignId) || isNaN(batchId) || !await requireBatch(campaignId, batchId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const runs = await db.select({
    id:               batchImportRunsTable.id,
    fileName:         batchImportRunsTable.fileName,
    status:           batchImportRunsTable.status,
    totalRows:        batchImportRunsTable.totalRows,
    validRows:        batchImportRunsTable.validRows,
    invalidRows:      batchImportRunsTable.invalidRows,
    duplicateRows:    batchImportRunsTable.duplicateRows,
    createdRows:      batchImportRunsTable.createdRows,
    processingTimeMs: batchImportRunsTable.processingTimeMs,
    createdAt:        batchImportRunsTable.createdAt,
    sourceName:       leadSourcesTable.sourceName,
    sourceType:       leadSourcesTable.sourceType,
  }).from(batchImportRunsTable)
    .leftJoin(leadSourcesTable, eq(batchImportRunsTable.sourceId, leadSourcesTable.id))
    .where(eq(batchImportRunsTable.batchId, batchId))
    .orderBy(desc(batchImportRunsTable.createdAt));

  const sourcesSummary = runs.reduce((acc, r) => {
    const key = r.sourceName ?? "Unknown";
    if (!acc[key]) {
      acc[key] = {
        sourceName: key,
        sourceType: r.sourceType ?? "csv",
        importRuns:  0,
        totalRows:   0,
        validRows:   0,
        duplicates:  0,
        errors:      0,
      };
    }
    acc[key].importRuns++;
    acc[key].totalRows  += r.totalRows;
    acc[key].validRows  += r.validRows;
    acc[key].duplicates += r.duplicateRows;
    acc[key].errors     += r.invalidRows;
    return acc;
  }, {} as Record<string, {
    sourceName: string; sourceType: string;
    importRuns: number; totalRows: number;
    validRows: number; duplicates: number; errors: number;
  }>);

  res.json({
    sources: Object.values(sourcesSummary),
    runs: runs.map(r => ({
      id:               r.id,
      fileName:         r.fileName,
      status:           r.status,
      totalRows:        r.totalRows,
      validRows:        r.validRows,
      invalidRows:      r.invalidRows,
      duplicateRows:    r.duplicateRows,
      createdRows:      r.createdRows,
      processingTimeMs: r.processingTimeMs,
      createdAt:        r.createdAt.toISOString(),
      sourceName:       r.sourceName ?? null,
      sourceType:       r.sourceType ?? null,
    })),
  });
});

// ── GET /campaigns/:id/batches/:batchId/workspace/header ──────────────────────

router.get("/campaigns/:id/batches/:batchId/workspace/header", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const batchId    = parseInt(req.params["batchId"]!, 10);
  const batch = await requireBatch(campaignId, batchId, userId);
  if (!batch) { res.status(404).json({ error: "Not found" }); return; }

  const [campaign] = await db.select({
    name:       campaignsTable.name,
    agentId:    campaignsTable.agentId,
    fromNumber: campaignsTable.fromNumber,
  }).from(campaignsTable).where(eq(campaignsTable.id, campaignId));

  const agentName = campaign?.agentId
    ? (await db.select({ name: agentsTable.name }).from(agentsTable).where(eq(agentsTable.id, campaign.agentId)))[0]?.name ?? null
    : null;

  // First import run source name
  const [firstRun] = await db.select({ sourceName: leadSourcesTable.sourceName, sourceType: leadSourcesTable.sourceType })
    .from(batchImportRunsTable)
    .leftJoin(leadSourcesTable, eq(batchImportRunsTable.sourceId, leadSourcesTable.id))
    .where(eq(batchImportRunsTable.batchId, batchId))
    .orderBy(batchImportRunsTable.createdAt)
    .limit(1);

  res.json({
    batch: {
      id:               batch.id,
      name:             batch.name,
      status:           batch.status,
      leadSource:       batch.leadSource,
      totalLeads:       batch.totalLeads,
      calledLeads:      batch.calledLeads,
      createdAt:        batch.createdAt.toISOString(),
      scheduledStartAt: batch.scheduledStartAt?.toISOString() ?? null,
      timezone:         batch.timezone ?? null,
      maxAttempts:      batch.maxAttempts,
      retryDelayMinutes: batch.retryDelayMinutes,
      batchFieldMapping: (batch as { batchFieldMapping?: Record<string, string> | null }).batchFieldMapping ?? null,
    },
    campaign: {
      id:         campaignId,
      name:       campaign?.name ?? "",
      agentId:    campaign?.agentId ?? null,
      agentName,
      fromNumber: campaign?.fromNumber ?? null,
    },
    source: firstRun ? {
      name: firstRun.sourceName ?? batch.leadSource,
      type: firstRun.sourceType ?? batch.leadSource,
    } : null,
  });
});

export default router;

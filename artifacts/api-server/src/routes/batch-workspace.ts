/**
 * Batch Workspace — Phase 4
 * ─────────────────────────────────────────────────────────────────────────────
 * Transforms a batch from an "import container" into an Operational Command Center.
 * Five focused read endpoints — controls (start/pause/stop/redial) stay in existing routes.
 */

import { Router, type IRouter } from "express";
import { getAuth } from "../lib/auth-compat.js";
import {
  db,
  campaignsTable, campaignBatchesTable, campaignLeadsTable,
  callExecutionsTable, callCallbacksTable, callBookingsTable,
  incomingCallsTable, callTransfersTable, leadTimelineTable,
  batchImportRunsTable, leadSourcesTable,
  agentsTable,
} from "@workspace/db";
import { eq, and, sql, desc, isNotNull, inArray } from "drizzle-orm";

const router: IRouter = Router();

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

// ── GET /campaigns/:id/batches/:batchId/workspace/kpis ────────────────────────

router.get("/campaigns/:id/batches/:batchId/workspace/kpis", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const batchId    = parseInt(req.params["batchId"]!, 10);
  if (isNaN(campaignId) || isNaN(batchId) || !await requireBatch(campaignId, batchId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  // Lead-level counters (one pass)
  const [leadKpis] = await db.select({
    total:      sql<number>`count(*)::int`,
    connected:  sql<number>`count(*) filter (where ${campaignLeadsTable.callStatus} in ('connected', 'completed', 'transferred'))::int`,
    failed:     sql<number>`count(*) filter (where ${campaignLeadsTable.callStatus} in ('failed', 'busy', 'no_pickup'))::int`,
    success:    sql<number>`count(*) filter (where ${campaignLeadsTable.operationalOutcome} in ('interest_confirmed','booking_created','transfer_completed'))::int`,
    pending:    sql<number>`count(*) filter (where ${campaignLeadsTable.callStatus} = 'pending')::int`,
  }).from(campaignLeadsTable)
    .where(eq(campaignLeadsTable.batchId, batchId));

  // Callbacks (join via lead)
  const [{ callbacks }] = await db.select({
    callbacks: sql<number>`count(distinct ${callCallbacksTable.id})::int`,
  }).from(callCallbacksTable)
    .innerJoin(campaignLeadsTable,
      and(eq(callCallbacksTable.leadId, campaignLeadsTable.id), eq(campaignLeadsTable.batchId, batchId))!,
    );

  // Incoming calls
  const [{ incoming }] = await db.select({
    incoming: sql<number>`count(*)::int`,
  }).from(incomingCallsTable)
    .where(eq(incomingCallsTable.batchId, batchId));

  // Bookings
  const [{ bookings }] = await db.select({
    bookings: sql<number>`count(*)::int`,
  }).from(callBookingsTable)
    .where(eq(callBookingsTable.batchId, batchId));

  // Transfers (via call_executions.batch_id)
  const [{ transfers }] = await db.select({
    transfers: sql<number>`count(distinct ${callTransfersTable.id})::int`,
  }).from(callTransfersTable)
    .innerJoin(callExecutionsTable,
      and(
        eq(callTransfersTable.callId, callExecutionsTable.callId!),
        eq(callExecutionsTable.batchId, batchId),
        isNotNull(callExecutionsTable.callId),
      )!,
    );

  const total = leadKpis?.total ?? 0;
  const successCount = leadKpis?.success ?? 0;
  const successRate = total > 0 ? Math.round((successCount / total) * 100) : 0;

  res.json({
    total,
    connected:   leadKpis?.connected  ?? 0,
    failed:      leadKpis?.failed     ?? 0,
    pending:     leadKpis?.pending    ?? 0,
    callbacks,
    incoming,
    bookings,
    transfers,
    successRate,
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

  const [r] = await db.select({
    imported:    sql<number>`count(*)::int`,
    called:      sql<number>`count(*) filter (where ${campaignLeadsTable.callAttempts} > 0)::int`,
    connected:   sql<number>`count(*) filter (where ${campaignLeadsTable.callStatus} in ('connected', 'completed', 'transferred'))::int`,
    interested:  sql<number>`count(*) filter (where ${campaignLeadsTable.operationalOutcome} in ('interest_confirmed','booking_created','transfer_completed'))::int`,
    booked:      sql<number>`count(*) filter (where ${campaignLeadsTable.operationalOutcome} = 'booking_created')::int`,
    transferred: sql<number>`count(*) filter (where ${campaignLeadsTable.operationalOutcome} = 'transfer_completed')::int`,
  }).from(campaignLeadsTable).where(eq(campaignLeadsTable.batchId, batchId));

  res.json({
    stages: [
      { key: "imported",    label: "Imported",    value: r?.imported    ?? 0 },
      { key: "called",      label: "Called",       value: r?.called      ?? 0 },
      { key: "connected",   label: "Connected",    value: r?.connected   ?? 0 },
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

  const baseWhere = and(
    eq(campaignLeadsTable.campaignId, campaignId),
    eq(campaignLeadsTable.batchId!, batchId),
  )!;

  const statusFilter =
    status === "pending"   ? eq(campaignLeadsTable.callStatus, "pending")   :
    status === "completed" ? eq(campaignLeadsTable.callStatus, "completed") :
    status === "failed"    ? eq(campaignLeadsTable.callStatus, "failed")    :
    status === "calling"   ? eq(campaignLeadsTable.callStatus, "calling")   :
    undefined;

  const outcomeFilter =
    outcome === "booking_created"    ? eq(campaignLeadsTable.operationalOutcome, "booking_created")    :
    outcome === "transfer_completed" ? eq(campaignLeadsTable.operationalOutcome, "transfer_completed") :
    outcome === "callback_requested" ? eq(campaignLeadsTable.operationalOutcome, "callback_requested") :
    outcome === "interest_confirmed" ? eq(campaignLeadsTable.operationalOutcome, "interest_confirmed") :
    outcome === "no_contact"         ? eq(campaignLeadsTable.operationalOutcome, "no_contact")         :
    outcome === "failed"             ? eq(campaignLeadsTable.operationalOutcome, "failed")             :
    undefined;

  const where = and(baseWhere, statusFilter, outcomeFilter)!;

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
    createdAt:          campaignLeadsTable.createdAt,
  }).from(campaignLeadsTable)
    .where(where)
    .orderBy(desc(campaignLeadsTable.lastAttemptAt), desc(campaignLeadsTable.createdAt))
    .limit(limit)
    .offset(page * limit);

  if (leads.length === 0) {
    res.json({ items: [], total, page, limit }); return;
  }

  const leadIds = leads.map(l => l.id);

  // Batch-load related records
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
    lastAttemptAt: l.lastAttemptAt?.toISOString() ?? null,
    createdAt:     l.createdAt.toISOString(),
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
      id:         batch.id,
      name:       batch.name,
      status:     batch.status,
      leadSource: batch.leadSource,
      totalLeads: batch.totalLeads,
      calledLeads: batch.calledLeads,
      createdAt:  batch.createdAt.toISOString(),
      scheduledStartAt: batch.scheduledStartAt?.toISOString() ?? null,
    },
    campaign: {
      id:         campaignId,
      name:       campaign?.name ?? "",
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

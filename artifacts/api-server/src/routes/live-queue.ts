/**
 * Campaign Live Queue routes
 * ─────────────────────────────────────────────────────────────────────────────
 * Real-time operational view of every lead in a campaign.
 * Powered by campaign_leads + call_retries + call_callbacks + calls + call_executions.
 */

import { Router, type IRouter } from "express";
import { getAuth } from "../lib/auth-compat.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext } from "../middlewares/clientContext.js";
import {
  db, campaignsTable, campaignLeadsTable, callsTable,
  callExecutionsTable, callRetriesTable, callCallbacksTable, leadTimelineTable,
} from "@workspace/db";
import { eq, and, sql, desc, or, inArray, ilike } from "drizzle-orm";

const router: IRouter = Router();

router.use(requireAuth, clientContext);

async function requireCampaign(campaignId: number, userId: string) {
  const [row] = await db.select({ id: campaignsTable.id })
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
  return row ?? null;
}

const RETRY_REASON_LABELS: Record<string, string> = {
  no_answer: "No answer",
  busy:      "Busy",
  failed:    "Call failed",
  voicemail: "Voicemail",
  manual:    "Manual retry",
};

function computeQueueReason(
  callStatus: string,
  operationalOutcome: string,
  retryReason: string | null | undefined,
  cbReason: string | null | undefined,
  cbRawExtract: string | null | undefined,
  execOutcome: string | null | undefined,
): string | null {
  if (callStatus === "pending" && retryReason) {
    return RETRY_REASON_LABELS[retryReason] ?? retryReason;
  }
  if (callStatus === "failed") {
    return execOutcome ? execOutcome.replace(/_/g, " ") : "No answer";
  }
  if (callStatus === "exhausted") return "Max attempts reached";
  if (callStatus === "skipped") return "Manually paused";
  if (operationalOutcome === "callback_requested") {
    const raw = cbRawExtract && cbRawExtract.length <= 80 ? cbRawExtract : null;
    return raw ?? cbReason ?? "Callback requested";
  }
  return null;
}

function slaStatus(responseDueBy: Date | null | undefined): string | null {
  if (!responseDueBy) return null;
  const diff = responseDueBy.getTime() - Date.now();
  if (diff < 0) return "overdue";
  if (diff < 15 * 60 * 1000) return "due-soon";
  return "ok";
}

// ── GET /campaigns/:id/live-queue/metrics ─────────────────────────────────────

router.get("/campaigns/:id/live-queue/metrics", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  if (isNaN(campaignId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const [m] = await db.select({
    total:             sql<number>`count(*)::int`,
    queued:            sql<number>`count(*) filter (where ${campaignLeadsTable.callStatus} = 'pending')::int`,
    calling:           sql<number>`count(*) filter (where ${campaignLeadsTable.callStatus} = 'calling')::int`,
    connected:         sql<number>`count(*) filter (where ${campaignLeadsTable.callStatus} = 'connected')::int`,
    nopickup:          sql<number>`count(*) filter (where ${campaignLeadsTable.callStatus} = 'failed')::int`,
    failed:            sql<number>`count(*) filter (where ${campaignLeadsTable.callStatus} = 'exhausted')::int`,
    callbackScheduled: sql<number>`count(*) filter (where ${campaignLeadsTable.operationalOutcome} = 'callback_requested')::int`,
  }).from(campaignLeadsTable).where(eq(campaignLeadsTable.campaignId, campaignId));

  const [retryRow] = await db.select({
    count: sql<number>`count(distinct ${callRetriesTable.leadId})::int`,
  }).from(callRetriesTable)
    .where(and(eq(callRetriesTable.campaignId, campaignId), eq(callRetriesTable.status, "pending")));

  res.json({
    total:             m?.total ?? 0,
    queued:            m?.queued ?? 0,
    calling:           m?.calling ?? 0,
    connected:         m?.connected ?? 0,
    retryScheduled:    retryRow?.count ?? 0,
    callbackScheduled: m?.callbackScheduled ?? 0,
    nopickup:          m?.nopickup ?? 0,
    failed:            m?.failed ?? 0,
  });
});

// ── GET /campaigns/:id/live-queue/leads ───────────────────────────────────────

router.get("/campaigns/:id/live-queue/leads", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  if (isNaN(campaignId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const tab         = String(req.query["tab"] ?? "all");
  const search      = String(req.query["search"] ?? "").trim();
  const disposition = String(req.query["disposition"] ?? "").trim();
  const outcome     = String(req.query["outcome"] ?? "").trim();
  const page        = Math.max(0, parseInt(String(req.query["page"] ?? "0"), 10) || 0);
  const limit       = Math.min(100, Math.max(1, parseInt(String(req.query["limit"] ?? "50"), 10) || 50));

  const conditions = [eq(campaignLeadsTable.campaignId, campaignId)];

  // Tab → callStatus / outcome filter
  if (tab === "calling")   conditions.push(eq(campaignLeadsTable.callStatus, "calling"));
  else if (tab === "queued")    conditions.push(eq(campaignLeadsTable.callStatus, "pending"));
  else if (tab === "connected") conditions.push(eq(campaignLeadsTable.callStatus, "connected"));
  else if (tab === "nopickup")  conditions.push(eq(campaignLeadsTable.callStatus, "failed"));
  else if (tab === "failed")    conditions.push(eq(campaignLeadsTable.callStatus, "exhausted"));
  else if (tab === "callback")  conditions.push(eq(campaignLeadsTable.operationalOutcome, "callback_requested"));
  else if (tab === "retry") {
    const retryLeadIds = await db.selectDistinct({ leadId: callRetriesTable.leadId })
      .from(callRetriesTable)
      .where(and(eq(callRetriesTable.campaignId, campaignId), eq(callRetriesTable.status, "pending")));
    const ids = retryLeadIds.map(r => r.leadId);
    if (ids.length === 0) { res.json({ leads: [], total: 0, page, limit }); return; }
    conditions.push(inArray(campaignLeadsTable.id, ids));
  }

  if (search) {
    conditions.push(or(
      ilike(campaignLeadsTable.phone, `%${search}%`),
      ilike(campaignLeadsTable.name!, `%${search}%`),
    )!);
  }
  if (disposition) conditions.push(eq(campaignLeadsTable.disposition!, disposition));
  if (outcome)     conditions.push(eq(campaignLeadsTable.operationalOutcome, outcome));

  const where = and(...conditions)!;

  const [countRow] = await db.select({ count: sql<number>`count(*)::int` })
    .from(campaignLeadsTable).where(where);
  const total = countRow?.count ?? 0;

  const rows = await db.select({
    id:               campaignLeadsTable.id,
    campaignId:       campaignLeadsTable.campaignId,
    batchId:          campaignLeadsTable.batchId,
    name:             campaignLeadsTable.name,
    phone:            campaignLeadsTable.phone,
    callStatus:       campaignLeadsTable.callStatus,
    operationalOutcome: campaignLeadsTable.operationalOutcome,
    disposition:      campaignLeadsTable.disposition,
    callAttempts:     campaignLeadsTable.callAttempts,
    lastAttemptAt:    campaignLeadsTable.lastAttemptAt,
    callId:           campaignLeadsTable.callId,
    createdAt:        campaignLeadsTable.createdAt,
  }).from(campaignLeadsTable)
    .where(where)
    .orderBy(desc(sql`coalesce(${campaignLeadsTable.lastAttemptAt}, ${campaignLeadsTable.createdAt})`))
    .limit(limit)
    .offset(page * limit);

  if (rows.length === 0) { res.json({ leads: [], total, page, limit }); return; }

  const leadIds = rows.map(r => r.id);

  // Duration from latest call
  const callIds = rows.filter(r => r.callId).map(r => r.callId!);
  const durationMap = new Map<number, { durationSeconds: number | null; costCents: number | null; executionId: string | null }>();
  if (callIds.length > 0) {
    const calls = await db.select({ id: callsTable.id, durationSeconds: callsTable.durationSeconds, costCents: callsTable.costCents, executionId: callsTable.executionId })
      .from(callsTable).where(inArray(callsTable.id, callIds));
    for (const c of calls) durationMap.set(c.id, { durationSeconds: c.durationSeconds ?? null, costCents: c.costCents ?? null, executionId: c.executionId ?? null });
  }

  // Next pending retry
  const retries = await db.select({ leadId: callRetriesTable.leadId, scheduledAt: callRetriesTable.scheduledAt, reason: callRetriesTable.reason })
    .from(callRetriesTable)
    .where(and(inArray(callRetriesTable.leadId, leadIds), eq(callRetriesTable.status, "pending")))
    .orderBy(callRetriesTable.scheduledAt);
  const nextRetryMap = new Map<number, { scheduledAt: Date; reason: string | null }>();
  for (const r of retries) { if (!nextRetryMap.has(r.leadId)) nextRetryMap.set(r.leadId, { scheduledAt: r.scheduledAt, reason: r.reason ?? null }); }

  // Pending callbacks
  const cbs = await db.select({
    leadId:        callCallbacksTable.leadId,
    callbackAt:    callCallbacksTable.callbackAt,
    responseDueBy: callCallbacksTable.responseDueBy,
    reason:        callCallbacksTable.reason,
    rawExtract:    callCallbacksTable.rawExtract,
  }).from(callCallbacksTable)
    .where(and(inArray(callCallbacksTable.leadId, leadIds), eq(callCallbacksTable.status, "pending")))
    .orderBy(callCallbacksTable.createdAt);
  const cbMap = new Map<number, { callbackAt: Date | null; responseDueBy: Date | null; reason: string | null; rawExtract: string | null }>();
  for (const cb of cbs) { if (!cbMap.has(cb.leadId)) cbMap.set(cb.leadId, { callbackAt: cb.callbackAt, responseDueBy: cb.responseDueBy, reason: cb.reason ?? null, rawExtract: cb.rawExtract ?? null }); }

  // Execution outcome for failed/exhausted leads → feeds queue_reason
  const failedIds = rows.filter(r => r.callStatus === "failed" || r.callStatus === "exhausted").map(r => r.id);
  const execOutcomeMap = new Map<number, string | null>();
  if (failedIds.length > 0) {
    const execs = await db.select({ leadId: callExecutionsTable.leadId, outcome: callExecutionsTable.outcome })
      .from(callExecutionsTable)
      .where(inArray(callExecutionsTable.leadId, failedIds))
      .orderBy(desc(callExecutionsTable.createdAt));
    for (const e of execs) {
      if (!execOutcomeMap.has(e.leadId)) execOutcomeMap.set(e.leadId, e.outcome ?? null);
    }
  }

  const leads = rows.map(r => {
    const cb = cbMap.get(r.id);
    const retry = nextRetryMap.get(r.id);
    return {
      id:               r.id,
      campaignId:       r.campaignId,
      batchId:          r.batchId ?? null,
      name:             r.name ?? null,
      phone:            r.phone,
      callStatus:       r.callStatus,
      operationalOutcome: r.operationalOutcome,
      disposition:      r.disposition ?? null,
      callAttempts:     r.callAttempts,
      callId:           r.callId ?? null,
      durationSeconds:  r.callId ? (durationMap.get(r.callId)?.durationSeconds ?? null) : null,
      costCents:        r.callId ? (durationMap.get(r.callId)?.costCents ?? null) : null,
      executionId:      r.callId ? (durationMap.get(r.callId)?.executionId ?? null) : null,
      lastAttemptAt:    r.lastAttemptAt?.toISOString() ?? null,
      nextRetryAt:      retry?.scheduledAt.toISOString() ?? null,
      callbackAt:       cb?.callbackAt?.toISOString() ?? null,
      responseDueBy:    cb?.responseDueBy?.toISOString() ?? null,
      slaStatus:        slaStatus(cb?.responseDueBy),
      queueReason:      computeQueueReason(r.callStatus, r.operationalOutcome, retry?.reason, cb?.reason, cb?.rawExtract, execOutcomeMap.get(r.id)),
      createdAt:        r.createdAt.toISOString(),
    };
  });

  res.json({ leads, total, page, limit });
});

// ── POST /campaigns/:id/live-queue/bulk-action ────────────────────────────────

router.post("/campaigns/:id/live-queue/bulk-action", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  if (isNaN(campaignId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const { action, leadIds } = req.body as { action: string; leadIds: number[] };
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    res.status(400).json({ error: "leadIds required" }); return;
  }

  const owned = await db.select({ id: campaignLeadsTable.id })
    .from(campaignLeadsTable)
    .where(and(inArray(campaignLeadsTable.id, leadIds), eq(campaignLeadsTable.campaignId, campaignId)));
  const ownedIds = owned.map(r => r.id);
  if (ownedIds.length === 0) { res.json({ action, affected: 0 }); return; }

  if (action === "retry") {
    await db.update(campaignLeadsTable)
      .set({ callStatus: "pending" })
      .where(inArray(campaignLeadsTable.id, ownedIds));
  } else if (action === "pause") {
    await db.update(campaignLeadsTable)
      .set({ callStatus: "skipped" })
      .where(inArray(campaignLeadsTable.id, ownedIds));
  } else {
    res.status(400).json({ error: "Invalid action" }); return;
  }

  res.json({ action, affected: ownedIds.length });
});

// ── GET /campaigns/:id/live-queue/export ──────────────────────────────────────

router.get("/campaigns/:id/live-queue/export", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  if (isNaN(campaignId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const tab    = String(req.query["tab"] ?? "all");
  const search = String(req.query["search"] ?? "").trim();

  const conditions = [eq(campaignLeadsTable.campaignId, campaignId)];
  if (tab === "calling")        conditions.push(eq(campaignLeadsTable.callStatus, "calling"));
  else if (tab === "queued")    conditions.push(eq(campaignLeadsTable.callStatus, "pending"));
  else if (tab === "connected") conditions.push(eq(campaignLeadsTable.callStatus, "connected"));
  else if (tab === "nopickup")  conditions.push(eq(campaignLeadsTable.callStatus, "failed"));
  else if (tab === "failed")    conditions.push(eq(campaignLeadsTable.callStatus, "exhausted"));
  else if (tab === "callback")  conditions.push(eq(campaignLeadsTable.operationalOutcome, "callback_requested"));

  if (search) {
    conditions.push(or(
      ilike(campaignLeadsTable.phone, `%${search}%`),
      ilike(campaignLeadsTable.name!, `%${search}%`),
    )!);
  }

  const rows = await db.select().from(campaignLeadsTable)
    .where(and(...conditions)!)
    .orderBy(desc(sql`coalesce(${campaignLeadsTable.lastAttemptAt}, ${campaignLeadsTable.createdAt})`))
    .limit(5000);

  const headers = ["ID", "Name", "Phone", "Status", "Outcome", "Disposition", "Attempts", "Last Attempt", "Created At"];
  const csvRows = rows.map(r => [
    r.id, r.name ?? "", r.phone, r.callStatus, r.operationalOutcome,
    r.disposition ?? "", r.callAttempts,
    r.lastAttemptAt?.toISOString() ?? "", r.createdAt.toISOString(),
  ].join(","));

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="live-queue-${campaignId}.csv"`);
  res.send([headers.join(","), ...csvRows].join("\n"));
});

// ── GET /campaigns/:id/leads/:leadId/drawer ───────────────────────────────────

router.get("/campaigns/:id/leads/:leadId/drawer", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const leadId     = parseInt(req.params["leadId"]!, 10);
  if (isNaN(campaignId) || isNaN(leadId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const [lead] = await db.select().from(campaignLeadsTable)
    .where(and(eq(campaignLeadsTable.id, leadId), eq(campaignLeadsTable.campaignId, campaignId)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const [latestExec] = await db.select({
    callSummary:    callExecutionsTable.callSummary,
    sentiment:      callExecutionsTable.sentiment,
    detectedIntent: callExecutionsTable.detectedIntent,
    outcome:        callExecutionsTable.outcome,
    attemptNumber:  callExecutionsTable.attemptNumber,
    createdAt:      callExecutionsTable.createdAt,
  }).from(callExecutionsTable)
    .where(eq(callExecutionsTable.leadId, leadId))
    .orderBy(desc(callExecutionsTable.createdAt)).limit(1);

  const [pendingRetry] = await db.select({ scheduledAt: callRetriesTable.scheduledAt, reason: callRetriesTable.reason })
    .from(callRetriesTable)
    .where(and(eq(callRetriesTable.leadId, leadId), eq(callRetriesTable.status, "pending")))
    .orderBy(callRetriesTable.scheduledAt).limit(1);

  const [pendingCb] = await db.select({
    callbackAt:    callCallbacksTable.callbackAt,
    responseDueBy: callCallbacksTable.responseDueBy,
    status:        callCallbacksTable.status,
  }).from(callCallbacksTable)
    .where(and(eq(callCallbacksTable.leadId, leadId), eq(callCallbacksTable.status, "pending")))
    .orderBy(desc(callCallbacksTable.createdAt)).limit(1);

  const timeline = await db.select({
    eventType: leadTimelineTable.eventType,
    data:      leadTimelineTable.data,
    createdAt: leadTimelineTable.createdAt,
  }).from(leadTimelineTable)
    .where(eq(leadTimelineTable.leadId, leadId))
    .orderBy(desc(leadTimelineTable.createdAt)).limit(8);

  res.json({
    lead: {
      id:               lead.id,
      campaignId:       lead.campaignId,
      batchId:          lead.batchId ?? null,
      name:             lead.name ?? null,
      phone:            lead.phone,
      email:            lead.email ?? null,
      callStatus:       lead.callStatus,
      operationalOutcome: lead.operationalOutcome,
      disposition:      lead.disposition ?? null,
      callAttempts:     lead.callAttempts,
      notes:            lead.notes ?? null,
      leadScore:        lead.leadScore ?? null,
      createdAt:        lead.createdAt.toISOString(),
      lastAttemptAt:    lead.lastAttemptAt?.toISOString() ?? null,
    },
    latestExecution: latestExec ? {
      callSummary:    latestExec.callSummary ?? null,
      sentiment:      latestExec.sentiment ?? null,
      detectedIntent: latestExec.detectedIntent ?? null,
      outcome:        latestExec.outcome ?? null,
      attemptNumber:  latestExec.attemptNumber,
      createdAt:      latestExec.createdAt.toISOString(),
    } : null,
    pendingRetry: pendingRetry ? {
      scheduledAt: pendingRetry.scheduledAt.toISOString(),
      reason:      pendingRetry.reason ?? null,
    } : null,
    pendingCallback: pendingCb ? {
      callbackAt:    pendingCb.callbackAt?.toISOString() ?? null,
      responseDueBy: pendingCb.responseDueBy?.toISOString() ?? null,
      status:        pendingCb.status,
    } : null,
    timelinePreview: timeline.map(t => ({
      eventType: t.eventType,
      data:      t.data ?? null,
      createdAt: t.createdAt.toISOString(),
    })),
  });
});

export default router;

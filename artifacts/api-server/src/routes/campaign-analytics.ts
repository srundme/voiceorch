/**
 * Campaign Analytics routes
 * ─────────────────────────────────────────────────────────────────────────────
 * Batch analytics, disposition breakdown, DNC management, and the
 * campaign-level aggregation endpoint (single source of truth from leads).
 */

import { Router, type IRouter } from "express";
import { getAuth } from "../lib/auth-compat.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext } from "../middlewares/clientContext.js";
import {
  db, campaignsTable, campaignLeadsTable, campaignBatchesTable,
  callCallbacksTable, callRetriesTable, workspaceDncTable,
  leadTimelineTable, callsTable,
} from "@workspace/db";
import { eq, and, count, sql, desc, isNotNull, inArray, ne } from "drizzle-orm";
import { normalizePhone } from "../lib/phone-normalize.js";

const router: IRouter = Router();

router.use(requireAuth, clientContext);

async function requireCampaign(campaignId: number, userId: string) {
  const [row] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
  return row ?? null;
}

// ── GET /campaigns/:id/batches/:batchId/analytics ────────────────────────────
router.get("/campaigns/:id/batches/:batchId/analytics", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const batchId    = parseInt(req.params["batchId"]!, 10);

  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const [batch] = await db.select().from(campaignBatchesTable)
    .where(and(eq(campaignBatchesTable.id, batchId), eq(campaignBatchesTable.campaignId, campaignId)));
  if (!batch) { res.status(404).json({ error: "Batch not found" }); return; }

  // Status breakdown
  const statusRows = await db
    .select({ status: campaignLeadsTable.callStatus, cnt: count() })
    .from(campaignLeadsTable)
    .where(and(
      eq(campaignLeadsTable.campaignId, campaignId),
      sql`${campaignLeadsTable.batchId} = ${batchId}`,
    ))
    .groupBy(campaignLeadsTable.callStatus);

  const statusMap: Record<string, number> = {};
  for (const r of statusRows) statusMap[r.status] = Number(r.cnt);

  // Disposition breakdown
  const dispRows = await db
    .select({ disposition: campaignLeadsTable.disposition, cnt: count() })
    .from(campaignLeadsTable)
    .where(and(
      eq(campaignLeadsTable.campaignId, campaignId),
      sql`${campaignLeadsTable.batchId} = ${batchId}`,
      isNotNull(campaignLeadsTable.disposition),
    ))
    .groupBy(campaignLeadsTable.disposition);

  const dispositions: Array<{ label: string; count: number }> = dispRows.map(r => ({
    label: r.disposition ?? "unknown",
    count: Number(r.cnt),
  }));

  // Callback count
  const [{ callbackCount }] = await db
    .select({ callbackCount: count() })
    .from(callCallbacksTable)
    .where(and(
      eq(callCallbacksTable.campaignId, campaignId),
      sql`EXISTS (SELECT 1 FROM campaign_leads cl WHERE cl.id = ${callCallbacksTable.leadId} AND cl.batch_id = ${batchId})`,
    ));

  // Retry count
  const [{ retryCount }] = await db
    .select({ retryCount: count() })
    .from(callRetriesTable)
    .where(and(
      eq(callRetriesTable.campaignId, campaignId),
      eq(callRetriesTable.status, "pending"),
      sql`EXISTS (SELECT 1 FROM campaign_leads cl WHERE cl.id = ${callRetriesTable.leadId} AND cl.batch_id = ${batchId})`,
    ));

  const total    = batch.totalLeads;
  const called   = statusMap["completed"] ?? 0;
  const failed   = (statusMap["failed"] ?? 0) + (statusMap["skipped"] ?? 0);
  const calling  = statusMap["calling"] ?? 0;
  const pending  = statusMap["pending"] ?? 0;
  const voicemail = statusMap["voicemail"] ?? 0;
  const answered = called;
  const notPicked = failed;

  res.json({
    batchId,
    batchName:   batch.name,
    batchStatus: batch.status,
    stats: {
      total,
      called,
      pending,
      calling,
      failed,
      voicemail,
      answered,
      notPicked,
      callbacks:   Number(callbackCount),
      pendingRetries: Number(retryCount),
      completionPct: total > 0 ? Math.round(((called + failed + voicemail) / total) * 100) : 0,
    },
    statusBreakdown: statusMap,
    dispositions,
  });
});

// ── GET /campaigns/:id/analytics ─────────────────────────────────────────────
// Single source of truth: all funnel counts aggregated live from campaign_leads.
// Never reads stale campaign.totalLeads / campaign.calledLeads counters.
router.get("/campaigns/:id/analytics", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  // Single-pass funnel aggregation from campaign_leads
  const [funnel] = await db.select({
    imported:    sql<number>`count(*)::int`,
    called:      sql<number>`count(*) filter (where ${campaignLeadsTable.callAttempts} > 0)::int`,
    connected:   sql<number>`count(*) filter (where ${campaignLeadsTable.callStatus} in ('connected','completed','transferred'))::int`,
    interested:  sql<number>`count(*) filter (where ${campaignLeadsTable.operationalOutcome} in ('interest_confirmed','booking_created','transfer_completed'))::int`,
    booked:      sql<number>`count(*) filter (where ${campaignLeadsTable.operationalOutcome} = 'booking_created')::int`,
    transferred: sql<number>`count(*) filter (where ${campaignLeadsTable.operationalOutcome} = 'transfer_completed')::int`,
    failed:      sql<number>`count(*) filter (where ${campaignLeadsTable.callStatus} in ('failed','busy','no_pickup'))::int`,
    voicemail:   sql<number>`count(*) filter (where ${campaignLeadsTable.callStatus} = 'voicemail')::int`,
    pending:     sql<number>`count(*) filter (where ${campaignLeadsTable.callStatus} = 'pending')::int`,
  }).from(campaignLeadsTable)
    .where(eq(campaignLeadsTable.campaignId, campaignId));

  // Disposition breakdown
  const dispRows = await db
    .select({ disposition: campaignLeadsTable.disposition, cnt: count() })
    .from(campaignLeadsTable)
    .where(and(
      eq(campaignLeadsTable.campaignId, campaignId),
      isNotNull(campaignLeadsTable.disposition),
    ))
    .groupBy(campaignLeadsTable.disposition);

  const dispositions: Array<{ label: string; count: number }> = dispRows.map(r => ({
    label: r.disposition ?? "unknown",
    count: Number(r.cnt),
  }));

  // Status breakdown (per callStatus value)
  const statusRows = await db
    .select({ status: campaignLeadsTable.callStatus, cnt: count() })
    .from(campaignLeadsTable)
    .where(eq(campaignLeadsTable.campaignId, campaignId))
    .groupBy(campaignLeadsTable.callStatus);

  const statusMap: Record<string, number> = {};
  for (const r of statusRows) statusMap[r.status] = Number(r.cnt);

  // Callbacks
  const [{ callbackCount }] = await db
    .select({ callbackCount: count() })
    .from(callCallbacksTable)
    .where(eq(callCallbacksTable.campaignId, campaignId));

  // Avg call duration + total cost — join campaign_leads to calls via call_id
  const [costDuration] = await db.select({
    avgDurationS: sql<number | null>`round(avg(${callsTable.durationSeconds}))::int`,
    totalCostCents: sql<number>`coalesce(sum(${callsTable.costCents}),0)::int`,
  }).from(campaignLeadsTable)
    .innerJoin(
      callsTable,
      and(
        eq(campaignLeadsTable.callId, callsTable.id),
        isNotNull(campaignLeadsTable.callId),
      )!,
    )
    .where(eq(campaignLeadsTable.campaignId, campaignId));

  const imported    = funnel?.imported    ?? 0;
  const called      = funnel?.called      ?? 0;
  const connected   = funnel?.connected   ?? 0;
  const interested  = funnel?.interested  ?? 0;
  const booked      = funnel?.booked      ?? 0;
  const transferred = funnel?.transferred ?? 0;
  const failed      = funnel?.failed      ?? 0;
  const voicemail   = funnel?.voicemail   ?? 0;
  const pending     = funnel?.pending     ?? 0;

  // successRate = booked / called (primary conversion metric)
  const successRate    = called > 0 ? Math.round((booked / called) * 100) : 0;
  const connectionRate = called > 0 ? Math.round((connected / called) * 100) : 0;
  const bookingRate    = connected > 0 ? Math.round((booked / connected) * 100) : 0;
  const totalCostCents = costDuration?.totalCostCents ?? 0;
  const avgCostPerBooking = booked > 0 ? Math.round(totalCostCents / booked) : null;

  res.json({
    campaignId,
    campaignName: campaign.name,
    dispositions,
    statusBreakdown: statusMap,
    callbacks: Number(callbackCount),
    totalLeads:  imported,
    calledLeads: called,
    imported,
    called,
    connected,
    interested,
    booked,
    transferred,
    failed,
    voicemail,
    pending,
    successRate,
    connectionRate,
    bookingRate,
    avgCallDurationS: costDuration?.avgDurationS ?? null,
    totalCostCents,
    avgCostPerBooking,
  });
});

// ── GET /campaigns/:id/activity ───────────────────────────────────────────────
// Merged stream: lead timeline events + synthetic batch lifecycle events.
// Sorted by timestamp desc, limited to `limit` total entries.
router.get("/campaigns/:id/activity", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const limit = Math.min(200, Math.max(1, parseInt(String(req.query["limit"] ?? "50"), 10) || 50));

  // 1. Lead timeline events (campaign_id indexed)
  const leadEvents = await db.select({
    id:        leadTimelineTable.id,
    leadId:    leadTimelineTable.leadId,
    eventType: leadTimelineTable.eventType,
    data:      leadTimelineTable.data,
    createdAt: leadTimelineTable.createdAt,
  }).from(leadTimelineTable)
    .where(eq(leadTimelineTable.campaignId, campaignId))
    .orderBy(desc(leadTimelineTable.createdAt))
    .limit(limit);

  // 2. Synthetic batch lifecycle events from campaign_batches
  const batches = await db.select({
    id:        campaignBatchesTable.id,
    name:      campaignBatchesTable.name,
    status:    campaignBatchesTable.status,
    createdAt: campaignBatchesTable.createdAt,
    updatedAt: campaignBatchesTable.updatedAt,
  }).from(campaignBatchesTable)
    .where(and(
      eq(campaignBatchesTable.campaignId, campaignId),
      ne(campaignBatchesTable.status, "draft"),
    ));

  type SynthEvent = {
    id: string;
    leadId: number | null;
    leadName: string | null;
    leadPhone: string | null;
    eventType: string;
    data: Record<string, unknown>;
    createdAt: string;
    isBatchEvent: true;
    batchName: string | null;
  };

  const batchEvents: SynthEvent[] = batches.flatMap(b => {
    const evs: SynthEvent[] = [];
    // Always emit a "batch_created" event at batch creation time
    evs.push({
      id:          `batch-created-${b.id}`,
      leadId:      null,
      leadName:    null,
      leadPhone:   null,
      eventType:   "batch_created",
      data:        { batchId: b.id, batchName: b.name },
      createdAt:   b.createdAt.toISOString(),
      isBatchEvent: true,
      batchName:   b.name,
    });
    // Emit a status event at updatedAt for non-draft, non-active statuses
    if (b.status !== "pending" && b.status !== "draft") {
      const statusEventType =
        b.status === "completed" ? "batch_completed" :
        b.status === "paused"    ? "batch_paused"    :
        b.status === "stopped"   ? "batch_stopped"   :
        b.status === "active"    ? "batch_started"   : `batch_${b.status}`;
      // Only add if updatedAt is meaningfully after createdAt (> 1 min)
      if (b.updatedAt.getTime() - b.createdAt.getTime() > 60_000) {
        evs.push({
          id:          `batch-${b.status}-${b.id}`,
          leadId:      null,
          leadName:    null,
          leadPhone:   null,
          eventType:   statusEventType,
          data:        { batchId: b.id, batchName: b.name, status: b.status },
          createdAt:   b.updatedAt.toISOString(),
          isBatchEvent: true,
          batchName:   b.name,
        });
      } else if (b.status === "active") {
        evs.push({
          id:          `batch-started-${b.id}`,
          leadId:      null,
          leadName:    null,
          leadPhone:   null,
          eventType:   "batch_started",
          data:        { batchId: b.id, batchName: b.name },
          createdAt:   b.createdAt.toISOString(),
          isBatchEvent: true,
          batchName:   b.name,
        });
      }
    }
    return evs;
  });

  // 3. Enrich lead events with name/phone
  const uniqueLeadIds = [...new Set(leadEvents.map(e => e.leadId))];
  const leadNames = uniqueLeadIds.length > 0
    ? await db.select({ id: campaignLeadsTable.id, name: campaignLeadsTable.name, phone: campaignLeadsTable.phone })
        .from(campaignLeadsTable).where(inArray(campaignLeadsTable.id, uniqueLeadIds))
    : [];
  const leadNameMap = new Map(leadNames.map(l => [l.id, { name: l.name, phone: l.phone }]));

  // 4. Merge and sort by timestamp desc, cap at limit
  type OutputEvent = {
    id: string | number;
    leadId: number | null;
    leadName: string | null;
    leadPhone: string | null;
    eventType: string;
    data: Record<string, unknown> | null;
    createdAt: string;
    batchName?: string | null;
  };

  const merged: OutputEvent[] = [
    ...leadEvents.map(e => ({
      id:        e.id,
      leadId:    e.leadId,
      leadName:  leadNameMap.get(e.leadId)?.name  ?? null,
      leadPhone: leadNameMap.get(e.leadId)?.phone ?? null,
      eventType: e.eventType,
      data:      e.data as Record<string, unknown> | null,
      createdAt: e.createdAt.toISOString(),
    })),
    ...batchEvents,
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);

  res.json({ events: merged });
});

// ── GET /campaigns/:id/csv-template ──────────────────────────────────────────
router.get("/campaigns/:id/csv-template", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const mappings = campaign.fieldMappings as Record<string, string>;
  const headers = Object.values(mappings).filter(Boolean);
  const uniqueHeaders = [...new Set(["phone", ...headers])];

  const csv = uniqueHeaders.join(",") + "\n";

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${campaign.name.replace(/[^a-z0-9]/gi, "_")}_template.csv"`);
  res.send(csv);
});

// ── GET /dnc ──────────────────────────────────────────────────────────────────
router.get("/dnc", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const rows = await db.select().from(workspaceDncTable)
    .where(and(eq(workspaceDncTable.userId, userId), eq(workspaceDncTable.isActive, true)))
    .orderBy(desc(workspaceDncTable.createdAt));

  res.json(rows.map(r => ({
    id:              r.id,
    phone:           r.phone,
    normalizedPhone: r.normalizedPhone,
    reason:          r.reason,
    createdAt:       r.createdAt.toISOString(),
  })));
});

// ── POST /dnc ─────────────────────────────────────────────────────────────────
router.post("/dnc", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const body = req.body as { phone?: string; reason?: string };
  if (!body.phone?.trim()) { res.status(400).json({ error: "phone required" }); return; }

  const normalized = normalizePhone(body.phone.trim());
  const [row] = await db.insert(workspaceDncTable)
    .values({ userId, phone: body.phone.trim(), normalizedPhone: normalized, reason: body.reason ?? null })
    .returning();

  res.status(201).json({
    id:              row!.id,
    phone:           row!.phone,
    normalizedPhone: row!.normalizedPhone,
    reason:          row!.reason,
    createdAt:       row!.createdAt.toISOString(),
  });
});

// ── DELETE /dnc/:id ───────────────────────────────────────────────────────────
router.delete("/dnc/:id", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params["id"]!, 10);
  const [deleted] = await db.update(workspaceDncTable)
    .set({ isActive: false })
    .where(and(eq(workspaceDncTable.id, id), eq(workspaceDncTable.userId, userId)))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).end();
});

// ── POST /campaigns/:id/lead-transfer/replay ──────────────────────────────────
router.post("/campaigns/:id/lead-transfer/replay", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const body = (req.body ?? {}) as {
    force?: boolean;
    limit?: number;
    dispositions?: string[];
  };

  const { replayCampaignLeadTransfers } = await import("../services/campaign-lead-transfer.js");
  const result = await replayCampaignLeadTransfers({
    campaignId,
    userId,
    force: body.force === true,
    limit: typeof body.limit === "number" ? body.limit : undefined,
    dispositions: Array.isArray(body.dispositions) ? body.dispositions : undefined,
  });
  res.json(result);
});

// ── POST /campaigns/:id/dispositions/act ──────────────────────────────────────
router.post("/campaigns/:id/dispositions/act", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const body = req.body as {
    disposition?: string;
    action?: "export" | "transfer" | "create_batch";
    force?: boolean;
    batchName?: string;
  };
  const disposition = (body.disposition ?? "").trim();
  const action = body.action;
  if (!disposition || !action) {
    res.status(400).json({ error: "disposition and action are required" });
    return;
  }
  if (!["export", "transfer", "create_batch"].includes(action)) {
    res.status(400).json({ error: "action must be export, transfer, or create_batch" });
    return;
  }

  const leads = await db
    .select()
    .from(campaignLeadsTable)
    .where(
      and(
        eq(campaignLeadsTable.campaignId, campaignId),
        eq(campaignLeadsTable.disposition, disposition),
      ),
    )
    .limit(5000);

  if (action === "export") {
    const header = ["id", "phone", "name", "email", "disposition", "callStatus", "callId"];
    const rows = leads.map((l) =>
      [l.id, l.phone, l.name ?? "", l.email ?? "", l.disposition ?? "", l.callStatus, l.callId ?? ""]
        .map((v) => {
          const s = String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    );
    const csv = [header.join(","), ...rows].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="campaign-${campaignId}-${disposition.replace(/[^a-z0-9_-]+/gi, "_")}.csv"`,
    );
    res.send(csv);
    return;
  }

  if (action === "transfer") {
    const { maybeTransferCampaignLead } = await import("../services/campaign-lead-transfer.js");
    let transferred = 0;
    let skipped = 0;
    for (const lead of leads) {
      if (!lead.callId) {
        skipped++;
        continue;
      }
      const [call] = await db
        .select({
          dispositionResult: callsTable.dispositionResult,
          callSummary: callsTable.callSummary,
        })
        .from(callsTable)
        .where(eq(callsTable.id, lead.callId))
        .limit(1);
      const result = await maybeTransferCampaignLead({
        callId: lead.callId,
        campaignLeadId: lead.id,
        dispositionResult: (call?.dispositionResult as Record<string, unknown> | null) ?? null,
        callSummary: call?.callSummary ?? null,
        force: body.force === true,
      });
      if (result.transferred) transferred++;
      else skipped++;
    }
    res.json({ action, disposition, matched: leads.length, transferred, skipped });
    return;
  }

  // create_batch — new draft batch with pending clones of this slice
  const batchName =
    (typeof body.batchName === "string" && body.batchName.trim()) ||
    `Redial — ${disposition}`.slice(0, 120);

  const [batch] = await db
    .insert(campaignBatchesTable)
    .values({
      campaignId,
      name: batchName,
      description: `Created from disposition slice: ${disposition}`,
      leadSource: "csv",
      status: "draft",
    })
    .returning();

  let inserted = 0;
  const toInsert = leads.map((l) => ({
    campaignId,
    batchId: batch!.id,
    phone: l.phone,
    normalizedPhone: l.normalizedPhone,
    name: l.name,
    email: l.email,
    leadData: l.leadData ?? {},
    source: "csv",
    callStatus: "pending",
  }));
  for (let i = 0; i < toInsert.length; i += 100) {
    const chunk = toInsert.slice(i, i + 100);
    if (!chunk.length) continue;
    await db.insert(campaignLeadsTable).values(chunk);
    inserted += chunk.length;
  }
  await db
    .update(campaignBatchesTable)
    .set({ totalLeads: inserted })
    .where(eq(campaignBatchesTable.id, batch!.id));
  await db
    .update(campaignsTable)
    .set({ totalLeads: sql`${campaignsTable.totalLeads} + ${inserted}` })
    .where(eq(campaignsTable.id, campaignId));

  res.json({
    action,
    disposition,
    matched: leads.length,
    batchId: batch!.id,
    batchName: batch!.name,
    inserted,
  });
});

export default router;

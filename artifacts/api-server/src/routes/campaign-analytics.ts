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
  leadTimelineTable, callsTable, callExecutionsTable,
  agentDispositionsTable,
} from "@workspace/db";
import { eq, and, count, sql, desc, isNotNull, inArray, ne, or } from "drizzle-orm";
import { normalizePhone } from "../lib/phone-normalize.js";
import { logger } from "../lib/logger.js";
import { canonicalDispositionBucket, dispositionBucketSql } from "../lib/disposition/canonical.js";
import { safelyReconcileCampaignTabs } from "../services/campaign-tab-sync.js";
import {
  campaignReportingKpiSelect,
  summarizeConfiguredDispositionHero,
  type CampaignDispositionTaxonomy,
} from "../services/campaign-lead-reporting.js";

const router: IRouter = Router();

/** Canonical disposition bucket for campaign leads — see lib/disposition/canonical. */
const CAMPAIGN_DISPOSITION_BUCKET_SQL = dispositionBucketSql(sql`${campaignLeadsTable.disposition}`);

router.use(requireAuth, clientContext);

async function requireCampaign(campaignId: number, userId: string) {
  const [row] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
  return row ?? null;
}

async function loadCampaignTaxonomy(agentId: number | null): Promise<CampaignDispositionTaxonomy> {
  if (agentId == null) return {};
  const [row] = await db.select({ taxonomy: agentDispositionsTable.taxonomy })
    .from(agentDispositionsTable)
    .where(eq(agentDispositionsTable.agentId, agentId))
    .limit(1);
  return row?.taxonomy && typeof row.taxonomy === "object" && !Array.isArray(row.taxonomy)
    ? row.taxonomy as CampaignDispositionTaxonomy
    : {};
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
    .select({
      answeredEver: campaignLeadsTable.answeredEver,
      disposition: campaignLeadsTable.disposition,
      lastAttemptStatus: campaignLeadsTable.lastAttemptStatus,
      callStatus: campaignLeadsTable.callStatus,
      cnt: count(),
    })
    .from(campaignLeadsTable)
    .where(and(
      eq(campaignLeadsTable.campaignId, campaignId),
      sql`${campaignLeadsTable.batchId} = ${batchId}`,
    ))
    .groupBy(
      campaignLeadsTable.answeredEver,
      campaignLeadsTable.disposition,
      campaignLeadsTable.lastAttemptStatus,
      campaignLeadsTable.callStatus,
    );

  const dispositions: Array<{ label: string; count: number }> = summarizeConfiguredDispositionHero(
    dispRows.map((r) => ({ ...r, count: Number(r.cnt) })),
    await loadCampaignTaxonomy(campaign.agentId),
  ).filter((item) => item.kind === "configured")
    .map((item) => ({ label: item.key, count: item.count }));

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

  const [canonical] = await db.select(campaignReportingKpiSelect())
    .from(campaignLeadsTable)
    .where(and(
      eq(campaignLeadsTable.campaignId, campaignId),
      eq(campaignLeadsTable.batchId, batchId),
    ));
  const total = canonical?.imported ?? 0;
  const called = canonical?.attempted ?? 0;
  const failed = canonical?.technicalFailed ?? 0;
  const calling = canonical?.calling ?? 0;
  const pending = canonical?.queued ?? 0;
  const voicemail = canonical?.voicemail ?? 0;
  const answered = canonical?.answered ?? 0;
  const notPicked = canonical?.noPickup ?? 0;

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
      completionPct: total > 0 ? Math.round((called / total) * 100) : 0,
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

  try {
  await safelyReconcileCampaignTabs(campaignId);

  // Same funnel as GET .../batches/:batchId/workspace/kpis (campaign-wide).
  const [funnel] = await db.select(campaignReportingKpiSelect())
    .from(campaignLeadsTable)
    .where(eq(campaignLeadsTable.campaignId, campaignId));

  // Bucket in JS. GROUP BY of dispositionBucketSql() parameterized CASE
  // disagrees between SELECT and GROUP BY in Postgres (500 on this route).
  const dispRaw = await db
    .select({
      answeredEver: campaignLeadsTable.answeredEver,
      disposition: campaignLeadsTable.disposition,
      lastAttemptStatus: campaignLeadsTable.lastAttemptStatus,
      callStatus: campaignLeadsTable.callStatus,
      cnt: count(),
    })
    .from(campaignLeadsTable)
    .where(and(
      eq(campaignLeadsTable.campaignId, campaignId),
    ))
    .groupBy(
      campaignLeadsTable.answeredEver,
      campaignLeadsTable.disposition,
      campaignLeadsTable.lastAttemptStatus,
      campaignLeadsTable.callStatus,
    );

  const dispositions: Array<{ label: string; count: number }> = summarizeConfiguredDispositionHero(
    dispRaw.map((r) => ({ ...r, count: Number(r.cnt) })),
    await loadCampaignTaxonomy(campaign.agentId),
  ).filter((item) => item.kind === "configured")
    .map((item) => ({ label: item.key, count: item.count }));

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

  let costDuration: { avgDurationS: number | null; totalCostCents: number } | undefined;
  try {
    const [row] = await db.select({
      avgDurationS: sql<number | null>`round(avg(${callsTable.durationSeconds}))::int`,
      totalCostCents: sql<number>`coalesce(sum(${callsTable.costCents}),0)::int`,
    }).from(campaignLeadsTable)
      .innerJoin(callsTable, eq(campaignLeadsTable.callId, callsTable.id))
      .where(and(
        eq(campaignLeadsTable.campaignId, campaignId),
        isNotNull(campaignLeadsTable.callId),
      ));
    costDuration = row;
  } catch (err) {
    logger.warn({ err, campaignId }, "Campaign analytics cost join failed");
  }

  const imported    = funnel?.imported ?? 0;
  const called      = funnel?.attempted ?? 0;
  const connected   = funnel?.answered ?? 0;
  const interested  = funnel?.interested ?? 0;
  const booked      = funnel?.booked ?? 0;
  const transferred = funnel?.transferred ?? 0;
  const failed      = funnel?.technicalFailed ?? 0;
  const busy        = funnel?.busy ?? 0;
  const noPickup    = funnel?.noPickup ?? 0;
  const voicemail   = funnel?.voicemail ?? 0;
  const pending     = funnel?.queued ?? 0;

  // successRate matches batch workspace KPIs (interested / called).
  const successRate    = called > 0 ? Math.round((interested / called) * 100) : 0;
  const connectionRate = called > 0 ? Math.round((connected / called) * 100) : 0;
  const bookingRate    = connected > 0 ? Math.round((booked / connected) * 100) : 0;
  const totalCostCents = costDuration?.totalCostCents ?? 0;
  const avgCostPerBooking = booked > 0 ? Math.round(totalCostCents / booked) : null;

  let intelligence = {
    analysed: 0,
    pendingAnalysis: 0,
    sentiment: [] as Array<{ label: string; count: number }>,
    intents: [] as Array<{ label: string; count: number }>,
    topTopics: [] as Array<{ label: string; count: number }>,
    hotLeads: 0,
  };
  try {
    const { getCampaignIntelligenceStats } = await import("../services/analyze-call-intelligence.js");
    intelligence = await getCampaignIntelligenceStats(campaignId);
  } catch {
    // Funnel numbers still return if transcript analysis is unavailable.
  }

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
    busy,
    noPickup,
    voicemail,
    pending,
    successRate,
    connectionRate,
    bookingRate,
    avgCallDurationS: costDuration?.avgDurationS ?? null,
    totalCostCents,
    avgCostPerBooking,
    intelligence,
  });
  } catch (err) {
    logger.error({ err, campaignId }, "GET /campaigns/:id/analytics failed");
    res.status(500).json({ error: "Analytics unavailable" });
  }
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

  // Match the canonical bucket, not the raw string, so a slice acts on every
  // lead the card counted regardless of how the label was spelled.
  const leads = await db
    .select()
    .from(campaignLeadsTable)
    .where(
      and(
        eq(campaignLeadsTable.campaignId, campaignId),
        sql`${CAMPAIGN_DISPOSITION_BUCKET_SQL} = ${canonicalDispositionBucket(disposition, "")}`,
      ),
    )
    .limit(5000);

  if (action === "export") {
    // Enrich each lead with its call summary + transcript so the exported report
    // is self-contained (users asked for these instead of re-opening every call).
    const callIds = Array.from(
      new Set(
        leads
          .map((l) => (l.callId != null ? Number(l.callId) : null))
          .filter((id): id is number => id != null && Number.isFinite(id)),
      ),
    );
    const callById = new Map<number, { durationSeconds: number | null; summary: string | null; transcript: string | null }>();
    const intelByCallId = new Map<number, { sentiment: string | null; intent: string | null; topics: string[] }>();
    if (callIds.length > 0) {
      const calls = await db
        .select({
          id: callsTable.id,
          durationSeconds: callsTable.durationSeconds,
          summary: callsTable.callSummary,
          transcript: callsTable.transcript,
        })
        .from(callsTable)
        .where(inArray(callsTable.id, callIds));
      for (const c of calls) {
        callById.set(c.id, { durationSeconds: c.durationSeconds, summary: c.summary, transcript: c.transcript });
      }
      const execs = await db
        .select({
          callId: callExecutionsTable.callId,
          sentiment: callExecutionsTable.sentiment,
          intent: callExecutionsTable.detectedIntent,
          topics: callExecutionsTable.keyTopics,
        })
        .from(callExecutionsTable)
        .where(inArray(callExecutionsTable.callId, callIds));
      for (const e of execs) {
        if (e.callId != null) {
          intelByCallId.set(e.callId, {
            sentiment: e.sentiment,
            intent: e.intent,
            topics: Array.isArray(e.topics) ? e.topics : [],
          });
        }
      }
    }

    const csvCell = (v: unknown): string => {
      const s = v == null ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = [
      "id", "phone", "name", "email", "disposition", "callStatus", "callId",
      "durationSec", "summary", "transcript", "sentiment", "intent", "topics",
    ];
    const rows = leads.map((l) => {
      const call = l.callId != null ? callById.get(Number(l.callId)) : undefined;
      const intel = l.callId != null ? intelByCallId.get(Number(l.callId)) : undefined;
      return [
        l.id, l.phone, l.name ?? "", l.email ?? "", l.disposition ?? "", l.callStatus, l.callId ?? "",
        call?.durationSeconds ?? "", call?.summary ?? "", call?.transcript ?? "",
        intel?.sentiment ?? "", intel?.intent ?? "", (intel?.topics ?? []).join("; "),
      ]
        .map(csvCell)
        .join(",");
    });
    // Prepend a UTF-8 BOM so Excel renders transcripts (which may contain
    // non-ASCII / Devanagari) correctly on open.
    const csv = "\uFEFF" + [header.join(","), ...rows].join("\n");
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

// ── POST /campaigns/:id/recampaign ────────────────────────────────────────────
// Clone selected lead slices into a new draft batch so users can redial
// dispositions (e.g. not interested) and/or no-pickup / failed statuses.
router.post("/campaigns/:id/recampaign", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const body = req.body as {
    batchName?: string;
    dispositions?: string[];
    callStatuses?: string[];
    sourceBatchId?: number;
  };

  const dispositions = Array.isArray(body.dispositions)
    ? [...new Set(body.dispositions.map((d) => String(d).trim()).filter(Boolean))]
    : [];
  const callStatuses = Array.isArray(body.callStatuses)
    ? [...new Set(body.callStatuses.map((s) => String(s).trim()).filter(Boolean))]
    : [];
  const sourceBatchId =
    typeof body.sourceBatchId === "number" && Number.isFinite(body.sourceBatchId)
      ? body.sourceBatchId
      : undefined;

  if (dispositions.length === 0 && callStatuses.length === 0) {
    res.status(400).json({ error: "Select at least one disposition or call status" });
    return;
  }

  if (sourceBatchId != null) {
    const [batch] = await db
      .select({ id: campaignBatchesTable.id })
      .from(campaignBatchesTable)
      .where(and(
        eq(campaignBatchesTable.id, sourceBatchId),
        eq(campaignBatchesTable.campaignId, campaignId),
      ))
      .limit(1);
    if (!batch) {
      res.status(404).json({ error: "Source batch not found" });
      return;
    }
  }

  const filters = [];
  if (dispositions.length > 0) {
    filters.push(inArray(campaignLeadsTable.disposition, dispositions));
  }
  if (callStatuses.length > 0) {
    filters.push(inArray(campaignLeadsTable.callStatus, callStatuses));
  }

  const whereParts = [
    eq(campaignLeadsTable.campaignId, campaignId),
    filters.length === 1 ? filters[0]! : or(...filters)!,
  ];
  if (sourceBatchId != null) {
    whereParts.push(eq(campaignLeadsTable.batchId, sourceBatchId));
  }

  const leads = await db
    .select()
    .from(campaignLeadsTable)
    .where(and(...whereParts))
    .limit(5000);

  if (leads.length === 0) {
    res.status(400).json({ error: "No leads matched the selected filters" });
    return;
  }

  // Deduplicate by normalized phone (or raw phone) so the same person isn't dialed twice.
  const seen = new Set<string>();
  const uniqueLeads = leads.filter((l) => {
    const key = (l.normalizedPhone || l.phone || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const filterSummary = [
    dispositions.length ? `dispositions=${dispositions.join("|")}` : null,
    callStatuses.length ? `statuses=${callStatuses.join("|")}` : null,
  ].filter(Boolean).join(", ");

  const batchName =
    (typeof body.batchName === "string" && body.batchName.trim()) ||
    `Re-campaign ${new Date().toISOString().slice(0, 10)}`.slice(0, 120);

  const [batch] = await db
    .insert(campaignBatchesTable)
    .values({
      campaignId,
      name: batchName,
      description: `Re-campaign from filters: ${filterSummary}`,
      leadSource: "csv",
      status: "draft",
    })
    .returning();

  let inserted = 0;
  const toInsert = uniqueLeads.map((l) => ({
    campaignId,
    batchId: batch!.id,
    phone: l.phone,
    normalizedPhone: l.normalizedPhone,
    name: l.name,
    email: l.email,
    leadData: {
      ...(typeof l.leadData === "object" && l.leadData !== null ? l.leadData as Record<string, unknown> : {}),
      recampaignedFromLeadId: String(l.id),
      previousDisposition: l.disposition ?? "",
      previousCallStatus: l.callStatus,
    } as Record<string, string>,
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
    .set({
      totalLeads: sql`${campaignsTable.totalLeads} + ${inserted}`,
      status: campaign.status === "completed" || campaign.status === "stopped" ? "active" : campaign.status,
      isActive: true,
    })
    .where(eq(campaignsTable.id, campaignId));

  res.json({
    matched: leads.length,
    inserted,
    deduped: leads.length - uniqueLeads.length,
    batchId: batch!.id,
    batchName: batch!.name,
    dispositions,
    callStatuses,
  });
});

// ── POST /campaigns/:id/intelligence/backfill ────────────────────────────────
// Re-analyse completed campaign calls that are missing sentiment/intent/topics.
// Safe to re-run; skips rows that already have sentiment unless force=true.
router.post("/campaigns/:id/intelligence/backfill", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const body = (req.body ?? {}) as { force?: boolean; limit?: number };
  const force = body.force === true;
  const limit = typeof body.limit === "number" ? body.limit : 500;

  const { backfillCampaignIntelligence } = await import("../services/analyze-call-intelligence.js");
  const result = await backfillCampaignIntelligence(campaignId, { force, limit, concurrency: 2 });
  res.json(result);
});

// ── GET /campaigns/:id/analytics/insights ────────────────────────────────────
// Trends (sentiment over time), custom-question scorecard, hot leads.
router.get("/campaigns/:id/analytics/insights", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const days = Math.min(Math.max(parseInt(String(req.query["days"] ?? "14"), 10) || 14, 1), 90);
  const batchIdRaw = req.query["batchId"];
  const batchId = batchIdRaw != null && String(batchIdRaw) !== ""
    ? parseInt(String(batchIdRaw), 10)
    : null;
  const { getCampaignAnalyticsInsights } = await import("../services/campaign-analytics-insights.js");
  const insights = await getCampaignAnalyticsInsights(campaignId, {
    days,
    batchId: Number.isFinite(batchId as number) ? batchId : null,
  });
  res.json(insights);
});

// ── GET/PUT /campaigns/:id/analytics-questions ───────────────────────────────
router.get("/campaigns/:id/analytics-questions", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  res.json({ questions: (campaign as { analyticsQuestions?: unknown }).analyticsQuestions ?? [] });
});

router.put("/campaigns/:id/analytics-questions", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const body = req.body as { questions?: unknown };
  const raw = Array.isArray(body.questions) ? body.questions : [];
  if (raw.length > 20) {
    res.status(400).json({ error: "Maximum 20 analytics questions per campaign" });
    return;
  }

  const questions: Array<{
    id: string;
    label: string;
    type: "boolean" | "enum" | "text";
    options?: string[];
    description?: string;
  }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const q = item as Record<string, unknown>;
    const label = String(q["label"] ?? "").trim();
    if (!label) continue;
    const type: "boolean" | "enum" | "text" =
      q["type"] === "enum" || q["type"] === "text" ? q["type"] : "boolean";
    const idRaw = String(q["id"] ?? "").trim();
    const slug =
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 40);
    const id = idRaw || slug || `q_${questions.length + 1}`;
    const options = Array.isArray(q["options"])
      ? q["options"].map((o: unknown) => String(o).trim()).filter(Boolean).slice(0, 12)
      : undefined;
    if (type === "enum" && (!options || options.length < 2)) {
      res.status(400).json({ error: `Enum question "${label}" needs at least 2 options` });
      return;
    }
    questions.push({
      id,
      label: label.slice(0, 160),
      type,
      options: type === "enum" ? options : undefined,
      description: q["description"] ? String(q["description"]).trim().slice(0, 400) : undefined,
    });
  }

  // Deduplicate ids
  const seen = new Set<string>();
  for (const q of questions) {
    let id = q.id;
    let n = 2;
    while (seen.has(id)) {
      id = `${q.id}_${n++}`;
    }
    q.id = id;
    seen.add(id);
  }

  await db
    .update(campaignsTable)
    .set({ analyticsQuestions: questions })
    .where(eq(campaignsTable.id, campaignId));

  res.json({ questions });
});

export default router;

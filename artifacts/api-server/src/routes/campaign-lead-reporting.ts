/**
 * Canonical campaign lead reporting API.
 *
 * Counts and row filters share campaignReportingViewSql / campaignReportingFilterSql.
 * Legacy funnel SQL in campaign-lead-funnel.ts remains unchanged for old callers.
 *
 *   GET /campaigns/:id/lead-reporting
 *   GET /campaigns/:id/lead-reporting/leads
 *   GET /campaigns/:id/batches/:batchId/lead-reporting
 */

import { Router, type IRouter } from "express";
import { and, count, desc, eq, sql } from "drizzle-orm";
import {
  db,
  campaignsTable,
  campaignLeadsTable,
  campaignBatchesTable,
  callRetriesTable,
  callsTable,
  callCallbacksTable,
  scheduledCallbacksTable,
} from "@workspace/db";
import { getAuth } from "../lib/auth-compat.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext } from "../middlewares/clientContext.js";
import { campaignLeadFunnelSelect, funnelFromRow } from "../lib/campaign-lead-funnel.js";
import {
  campaignReportingFilterSql,
  campaignReportingKpiSelect,
  campaignReportingLeadProjectionSelect,
  campaignReportingRates,
  campaignReportingSql,
  parseCampaignReportingFilter,
  projectCampaignLeadReporting,
} from "../services/campaign-lead-reporting.js";

const router: IRouter = Router();
router.use(requireAuth, clientContext);

async function requireCampaign(campaignId: number, userId: string) {
  const [row] = await db.select({
    id: campaignsTable.id,
    name: campaignsTable.name,
    concurrentCallLimit: campaignsTable.concurrentCallLimit,
  }).from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
  return row ?? null;
}

async function requireBatch(campaignId: number, batchId: number) {
  const [row] = await db.select({ id: campaignBatchesTable.id })
    .from(campaignBatchesTable)
    .where(and(eq(campaignBatchesTable.id, batchId), eq(campaignBatchesTable.campaignId, campaignId)));
  return row ?? null;
}

function scopeWhere(campaignId: number, batchId?: number) {
  return batchId != null
    ? and(eq(campaignLeadsTable.campaignId, campaignId), eq(campaignLeadsTable.batchId, batchId))
    : eq(campaignLeadsTable.campaignId, campaignId);
}

async function loadReporting(opts: {
  campaignId: number;
  batchId?: number;
  concurrentCallLimit: number;
}) {
  const where = scopeWhere(opts.campaignId, opts.batchId);
  const [canonical] = await db.select(campaignReportingKpiSelect())
    .from(campaignLeadsTable)
    .where(where);
  const [legacyRow] = await db.select(campaignLeadFunnelSelect())
    .from(campaignLeadsTable)
    .where(where);
  const legacy = funnelFromRow(legacyRow);

  const [retryRows] = await db.select({
    retryRowCount: sql<number>`count(*)::int`,
  }).from(callRetriesTable)
    .innerJoin(campaignLeadsTable, eq(callRetriesTable.leadId, campaignLeadsTable.id))
    .where(and(
      eq(callRetriesTable.status, "pending"),
      eq(campaignLeadsTable.campaignId, opts.campaignId),
      opts.batchId != null ? eq(campaignLeadsTable.batchId, opts.batchId) : sql`true`,
    ));

  const [callbackTableRow] = await db.select({
    n: sql<number>`count(distinct ${campaignLeadsTable.id})::int`,
  }).from(campaignLeadsTable)
    .where(and(
      where,
      sql`(
        exists (select 1 from ${callCallbacksTable} c where c.lead_id = ${campaignLeadsTable.id})
        or exists (select 1 from ${scheduledCallbacksTable} s where s.campaign_lead_id = ${campaignLeadsTable.id})
      )`,
    ));
  const callbackTableLeads = callbackTableRow?.n ?? 0;

  const batchKpiRows = await db.select({
    batchId: campaignLeadsTable.batchId,
    imported: sql<number>`count(*)::int`,
    attempted: sql<number>`count(*) filter (where ${campaignReportingSql.attempted})::int`,
    answered: sql<number>`count(*) filter (where ${campaignReportingSql.answered})::int`,
    interested: sql<number>`count(*) filter (where ${campaignReportingSql.interested})::int`,
    retryPending: sql<number>`count(*) filter (where ${campaignReportingSql.retryPending})::int`,
  }).from(campaignLeadsTable)
    .where(where)
    .groupBy(campaignLeadsTable.batchId);

  const batchIds = batchKpiRows.map((r) => r.batchId).filter((id): id is number => id != null);
  const batchMeta = batchIds.length > 0
    ? await db.select({
      id: campaignBatchesTable.id,
      name: campaignBatchesTable.name,
      status: campaignBatchesTable.status,
    }).from(campaignBatchesTable).where(sql`${campaignBatchesTable.id} in (${sql.join(batchIds.map((id) => sql`${id}`), sql`, `)})`)
    : [];
  const batchMetaMap = new Map(batchMeta.map((b) => [b.id, b]));
  const batches = batchKpiRows.map((r) => {
    const meta = r.batchId != null ? batchMetaMap.get(r.batchId) : undefined;
    const imported = r.imported ?? 0;
    const attempted = r.attempted ?? 0;
    return {
      batchId: r.batchId,
      name: meta?.name ?? (r.batchId != null ? `Batch ${r.batchId}` : "Unbatched"),
      status: meta?.status ?? "unknown",
      imported,
      attempted,
      answered: r.answered ?? 0,
      interested: r.interested ?? 0,
      retryPending: r.retryPending ?? 0,
      progressPct: imported > 0 ? Math.round((attempted / imported) * 100) : 0,
    };
  });

  const landing = await db.select({
    lastAttemptStatus: campaignLeadsTable.lastAttemptStatus,
    operationalOutcome: campaignLeadsTable.operationalOutcome,
    cnt: count(),
  }).from(campaignLeadsTable)
    .where(and(where, campaignReportingSql.historicalAnsweredFailed))
    .groupBy(campaignLeadsTable.lastAttemptStatus, campaignLeadsTable.operationalOutcome);

  const imported = canonical?.imported ?? 0;
  const attempted = canonical?.attempted ?? 0;
  const answered = canonical?.answered ?? 0;
  const interested = canonical?.interested ?? 0;
  const booked = canonical?.booked ?? 0;
  const transferred = canonical?.transferred ?? 0;
  const talking = canonical?.talking ?? 0;
  const calling = canonical?.calling ?? 0;
  const queued = canonical?.queued ?? 0;
  const slotsUsed = canonical?.slotsUsed ?? (calling + talking);
  const concurrencyLimit = opts.concurrentCallLimit;
  const platformCap = Math.max(0, Number(process.env.PLATFORM_MAX_CONCURRENT_CALLS ?? 0));
  const availableConcurrency = Math.max(0, concurrencyLimit - slotsUsed);

  return {
    funnel: {
      imported,
      attempted,
      answered,
      interested,
      booked,
      transferred,
    },
    liveFloor: {
      queued,
      calling,
      talking,
      slotsUsed,
      concurrencyLimit,
      availableConcurrency,
      platformCap: platformCap > 0 ? platformCap : null,
    },
    workTechnical: {
      retryPending: canonical?.retryPending ?? 0,
      retryRowCount: retryRows?.retryRowCount ?? 0,
      callbacks: canonical?.callbacks ?? 0,
      callbackTableLeads: callbackTableLeads,
      noPickup: canonical?.noPickup ?? 0,
      busy: canonical?.busy ?? 0,
      voicemail: canonical?.voicemail ?? 0,
      technicalFailed: canonical?.technicalFailed ?? 0,
    },
    rates: campaignReportingRates({
      attempted,
      answered,
      interested,
      legacyInterested: legacy.interested,
    }),
    compare: {
      imported: { legacy: legacy.imported, canonical: imported },
      attempted: { legacy: legacy.called, canonical: attempted },
      connectedVsAnswered: { legacyConnected: legacy.connected, canonicalAnswered: answered },
      failedVsTechnicalFailed: { legacyFailed: legacy.failed, canonicalTechnicalFailed: canonical?.technicalFailed ?? 0 },
      interested: { legacy: legacy.interested, canonical: interested },
      callback: { canonical: canonical?.callbacks ?? 0 },
      busy: { legacy: legacy.busy, canonical: canonical?.busy ?? 0 },
      noPickup: { legacy: legacy.noPickup, canonical: canonical?.noPickup ?? 0 },
      voicemail: { legacy: legacy.voicemail, canonical: canonical?.voicemail ?? 0 },
      retryPending: { canonicalLeads: canonical?.retryPending ?? 0, pendingRetryRows: retryRows?.retryRowCount ?? 0 },
      callbackSources: {
        operationalOutcome: canonical?.callbacks ?? 0,
        callbackTables: callbackTableLeads,
      },
    },
    batches,
    historicalAnsweredFailed: {
      count: canonical?.historicalAnsweredFailed ?? 0,
      landing: landing.map((r) => ({
        lastAttemptStatus: r.lastAttemptStatus,
        operationalOutcome: r.operationalOutcome,
        count: Number(r.cnt),
      })),
      note: "Answered = yes. Technical Failed = no. Raw lifecycleStatus remains failed and is not remapped.",
    },
  };
}

router.get("/campaigns/:id/lead-reporting", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const campaignId = parseInt(req.params["id"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const payload = await loadReporting({
    campaignId,
    concurrentCallLimit: campaign.concurrentCallLimit ?? 20,
  });
  res.json({
    campaignId,
    campaignName: campaign.name,
    ...payload,
  });
});

router.get("/campaigns/:id/batches/:batchId/lead-reporting", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const campaignId = parseInt(req.params["id"]!, 10);
  const batchId = parseInt(req.params["batchId"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }
  if (!await requireBatch(campaignId, batchId)) { res.status(404).json({ error: "Batch not found" }); return; }

  const payload = await loadReporting({
    campaignId,
    batchId,
    concurrentCallLimit: campaign.concurrentCallLimit ?? 20,
  });
  res.json({
    campaignId,
    batchId,
    campaignName: campaign.name,
    ...payload,
  });
});

router.get("/campaigns/:id/lead-reporting/leads", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const campaignId = parseInt(req.params["id"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const filter = parseCampaignReportingFilter(req.query as Record<string, unknown>);
  const page = Math.max(0, parseInt(String(req.query["page"] ?? "0"), 10) || 0);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query["limit"] ?? "50"), 10) || 50));

  const where = and(
    eq(campaignLeadsTable.campaignId, campaignId),
    ...campaignReportingFilterSql(filter),
  )!;

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(campaignLeadsTable)
    .where(where);

  const rows = await db.select(campaignReportingLeadProjectionSelect())
    .from(campaignLeadsTable)
    .leftJoin(callsTable, eq(campaignLeadsTable.callId, callsTable.id))
    .where(where)
    .orderBy(desc(campaignLeadsTable.lastAttemptAt), desc(campaignLeadsTable.id))
    .limit(limit)
    .offset(page * limit);

  res.json({
    campaignId,
    filter,
    total,
    page,
    limit,
    items: rows.map((row) => projectCampaignLeadReporting({
      id: row.id,
      batchId: row.batchId,
      phone: row.phone,
      name: row.name,
      source: row.source,
      answeredEver: row.answeredEver,
      callStatus: row.callStatus,
      lastAttemptStatus: row.lastAttemptStatus,
      operationalOutcome: row.operationalOutcome,
      disposition: row.disposition,
      callAttempts: row.callAttempts,
      callId: row.callId,
      latestAnsweredDuration: row.latestAnsweredDuration,
      retryPending: Boolean(row.retryPending),
      retryScheduledAt: row.retryScheduledAt,
      retryReason: row.retryReason,
      retryCount: Number(row.retryCount ?? 0),
      retryAttemptNumber: row.retryAttemptNumber == null ? null : Number(row.retryAttemptNumber),
    })),
  });
});

export default router;

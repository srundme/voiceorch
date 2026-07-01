/**
 * Campaign Operations Dashboard — aggregation endpoint.
 * GET /campaigns/dashboard
 * Returns summary stats + per-campaign enriched rows in one round-trip.
 *
 * Fault-tolerant: every sub-query has an individual .catch(() => []) so a
 * single failing enrichment query never kills the whole response. Any query
 * failure is logged so it shows up in Railway logs.
 */
import { Router } from "express";
import { getAuth } from "../lib/auth-compat.js";
import {
  db,
  campaignsTable,
  campaignLeadsTable,
  agentsTable,
  callBookingsTable,
} from "@workspace/db";
import { eq, and, gte, lt, inArray, count, desc } from "drizzle-orm";
import { decryptKey } from "../lib/crypto.js";

const router = Router();

function todayUtcBounds() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end   = new Date(start.getTime() + 86_400_000);
  return { start, end, yesterday: new Date(start.getTime() - 86_400_000), now };
}

type HealthStatus =
  | "healthy"
  | "no_agent"
  | "no_number"
  | "validation_error"
  | "webhook_offline"
  | "outside_hours";

function computeHealth(c: typeof campaignsTable.$inferSelect, now: Date): HealthStatus {
  if (!c.agentId) return "no_agent";
  if (!c.fromNumber) return "no_number";
  if (c.lastValidationError) return "validation_error";
  const needsWebhook =
    c.leadSource === "webhook" ||
    c.leadSource === "meta_ads" ||
    (c.leadSource === "crm" && (c.triggerMode ?? "batch") === "instant");
  if (needsWebhook) {
    if (!c.lastWebhookAt) return "webhook_offline";
    const staleMs = now.getTime() - c.lastWebhookAt.getTime();
    if (staleMs > 60 * 60 * 1000) return "webhook_offline"; // > 1 hour
  }
  if (c.isCallingHoursEnabled && c.businessHoursStart != null && c.businessHoursEnd != null) {
    const hour = now.getUTCHours();
    if (hour < c.businessHoursStart || hour >= c.businessHoursEnd) return "outside_hours";
  }
  return "healthy";
}

function serializeCampaign(row: typeof campaignsTable.$inferSelect) {
  return {
    id:                    row.id,
    name:                  row.name,
    description:           row.description,
    agentId:               row.agentId,
    status:                row.status,
    webhookToken:          row.webhookToken,
    fromNumber:            row.fromNumber,
    totalLeads:            row.totalLeads,
    calledLeads:           row.calledLeads,
    isActive:              row.isActive,
    leadSource:            row.leadSource ?? "csv",
    triggerMode:           row.triggerMode ?? "batch",
    lastWebhookAt:         row.lastWebhookAt?.toISOString() ?? null,
    lastWebhookStatus:     row.lastWebhookStatus ?? null,
    lastValidationError:   row.lastValidationError ?? null,
    isCallingHoursEnabled: row.isCallingHoursEnabled,
    businessHoursStart:    row.businessHoursStart ?? null,
    businessHoursEnd:      row.businessHoursEnd ?? null,
    timezone:              row.timezone ?? null,
    metaPageAccessTokenHint: row.metaPageAccessToken
      ? (() => { try { const t = decryptKey(row.metaPageAccessToken!); return `…${t.slice(-6)}`; } catch { return "…(set)"; } })()
      : null,
    concurrentCallLimit:   row.concurrentCallLimit,
    maxAttempts:           row.maxAttempts,
    retryDelayMinutes:     row.retryDelayMinutes,
    fieldMappings:         row.fieldMappings,
    createdAt:             row.createdAt.toISOString(),
    updatedAt:             row.updatedAt.toISOString(),
  };
}

const ZERO_STATS = {
  activeCampaigns:    0,
  listeningCampaigns: 0,
  liveCalls:          0,
  queuedLeads:        0,
  todayLeads:         0,
  todayBookings:      0,
};

router.get("/campaigns/dashboard", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { start: todayStart, yesterday: yestStart, now } = todayUtcBounds();

  // ── 1. fetch campaigns ────────────────────────────────────────────────────
  let campaigns: (typeof campaignsTable.$inferSelect)[];
  try {
    campaigns = await db.select().from(campaignsTable)
      .where(eq(campaignsTable.userId, userId))
      .orderBy(desc(campaignsTable.createdAt));
  } catch (err) {
    req.log.error({ err }, "campaign-dashboard: failed to fetch campaigns");
    res.status(500).json({ error: "Failed to load campaigns" });
    return;
  }

  if (campaigns.length === 0) {
    res.json({ stats: ZERO_STATS, campaigns: [] });
    return;
  }

  const ids = campaigns.map(c => c.id);
  const uniqueAgentIds = [...new Set(campaigns.map(c => c.agentId).filter((id): id is number => id != null))];

  // ── 2. parallel enrichment — runSafe wraps each query so a failing
  //       sub-query never kills the whole response; the fallback is typed
  //       identically to the happy-path so TypeScript infers cleanly. ────────
  async function runSafe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try { return await fn(); }
    catch (err) { req.log.error({ err }, `campaign-dashboard: sub-query '${label}' failed`); return fallback; }
  }

  type LeadRow    = { campaignId: number | null; n: number };
  type AgentRow   = { id: number; name: string };
  const noLeads: LeadRow[]  = [];
  const noAgents: AgentRow[] = [];

  const [
    agentRows,
    todayLeadRows,
    yestLeadRows,
    queuedRows,
    callingRows,
    completedRows,
    bookedTodayRows,
  ] = await Promise.all([
    runSafe("agents", () =>
      uniqueAgentIds.length > 0
        ? db.select({ id: agentsTable.id, name: agentsTable.name }).from(agentsTable)
            .where(inArray(agentsTable.id, uniqueAgentIds))
        : Promise.resolve(noAgents),
      noAgents,
    ),

    runSafe("todayLeads", () =>
      db.select({ campaignId: campaignLeadsTable.campaignId, n: count() })
        .from(campaignLeadsTable)
        .where(and(inArray(campaignLeadsTable.campaignId, ids), gte(campaignLeadsTable.createdAt, todayStart)))
        .groupBy(campaignLeadsTable.campaignId) as Promise<LeadRow[]>,
      noLeads,
    ),

    runSafe("yestLeads", () =>
      db.select({ campaignId: campaignLeadsTable.campaignId, n: count() })
        .from(campaignLeadsTable)
        .where(and(
          inArray(campaignLeadsTable.campaignId, ids),
          gte(campaignLeadsTable.createdAt, yestStart),
          lt(campaignLeadsTable.createdAt, todayStart),
        ))
        .groupBy(campaignLeadsTable.campaignId) as Promise<LeadRow[]>,
      noLeads,
    ),

    runSafe("queuedLeads", () =>
      db.select({ campaignId: campaignLeadsTable.campaignId, n: count() })
        .from(campaignLeadsTable)
        .where(and(inArray(campaignLeadsTable.campaignId, ids), eq(campaignLeadsTable.callStatus, "pending")))
        .groupBy(campaignLeadsTable.campaignId) as Promise<LeadRow[]>,
      noLeads,
    ),

    runSafe("callingLeads", () =>
      db.select({ campaignId: campaignLeadsTable.campaignId, n: count() })
        .from(campaignLeadsTable)
        .where(and(inArray(campaignLeadsTable.campaignId, ids), eq(campaignLeadsTable.callStatus, "calling")))
        .groupBy(campaignLeadsTable.campaignId) as Promise<LeadRow[]>,
      noLeads,
    ),

    runSafe("completedLeads", () =>
      db.select({ campaignId: campaignLeadsTable.campaignId, n: count() })
        .from(campaignLeadsTable)
        .where(and(
          inArray(campaignLeadsTable.campaignId, ids),
          inArray(campaignLeadsTable.callStatus, ["completed", "transferred"]),
        ))
        .groupBy(campaignLeadsTable.campaignId) as Promise<LeadRow[]>,
      noLeads,
    ),

    runSafe("bookedToday", () =>
      db.select({ campaignId: callBookingsTable.campaignId, n: count() })
        .from(callBookingsTable)
        .where(and(inArray(callBookingsTable.campaignId, ids), gte(callBookingsTable.createdAt, todayStart)))
        .groupBy(callBookingsTable.campaignId) as Promise<LeadRow[]>,
      noLeads,
    ),
  ]);

  const agentMap     = new Map(agentRows.map(a => [a.id, a.name]));
  const todayMap     = new Map(todayLeadRows.map(r => [r.campaignId, Number(r.n)]));
  const yestMap      = new Map(yestLeadRows.map(r => [r.campaignId, Number(r.n)]));
  const queuedMap    = new Map(queuedRows.map(r => [r.campaignId, Number(r.n)]));
  const callingMap   = new Map(callingRows.map(r => [r.campaignId, Number(r.n)]));
  const completedMap = new Map(completedRows.map(r => [r.campaignId, Number(r.n)]));
  const bookedMap    = new Map(bookedTodayRows.map(r => [r.campaignId, Number(r.n)]));

  const LISTENING_SOURCES = ["webhook", "meta_ads", "crm"];

  const stats = {
    activeCampaigns:    campaigns.filter(c => ["active", "listening"].includes(c.status)).length,
    listeningCampaigns: campaigns.filter(c => c.status === "active" && LISTENING_SOURCES.includes(c.leadSource)).length,
    liveCalls:          callingRows.reduce<number>((s, r) => s + Number(r.n), 0),
    queuedLeads:        queuedRows.reduce<number>((s, r) => s + Number(r.n), 0),
    todayLeads:         todayLeadRows.reduce<number>((s, r) => s + Number(r.n), 0),
    todayBookings:      bookedTodayRows.reduce<number>((s, r) => s + Number(r.n), 0),
  };

  const enriched = campaigns.map(c => {
    const todayN    = todayMap.get(c.id) ?? 0;
    const yestN     = yestMap.get(c.id) ?? 0;
    const queued    = queuedMap.get(c.id) ?? 0;
    const calling   = callingMap.get(c.id) ?? 0;
    const completed = completedMap.get(c.id) ?? 0;
    const booked    = bookedMap.get(c.id) ?? 0;
    const health    = computeHealth(c, now);

    let lastActivity: { label: string; at: string } | null = null;
    if (c.lastWebhookAt) {
      lastActivity = { label: "Lead received", at: c.lastWebhookAt.toISOString() };
    } else if (c.updatedAt > c.createdAt) {
      lastActivity = { label: "Updated", at: c.updatedAt.toISOString() };
    } else {
      lastActivity = { label: "Created", at: c.createdAt.toISOString() };
    }

    return {
      ...serializeCampaign(c),
      agentName:      c.agentId ? (agentMap.get(c.agentId) ?? null) : null,
      todayLeads:     todayN,
      yesterdayLeads: yestN,
      queuedLeads:    queued,
      callingLeads:   calling,
      completedLeads: completed,
      bookedToday:    booked,
      campaignHealth: health,
      lastActivity,
    };
  });

  res.json({ stats, campaigns: enriched });
});

export default router;

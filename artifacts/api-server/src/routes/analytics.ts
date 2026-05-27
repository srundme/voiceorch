import { Router, type IRouter } from "express";
import { desc, sql, eq, gte, and } from "drizzle-orm";
import { db, callsTable, agentsTable, providersTable } from "@workspace/db";
import {
  GetDashboardStatsResponse,
  GetRecentCallsResponse,
  GetCallsByStatusResponse,
  GetDailyCallVolumeResponse,
  GetAgentStatsParams,
  GetAgentStatsResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth.js";

const router: IRouter = Router();

router.get("/analytics/dashboard", async (req, res): Promise<void> => {
  const [agentStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where status = 'active')::int`,
    })
    .from(agentsTable);

  const [callStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      successful: sql<number>`count(*) filter (where status = 'completed')::int`,
      avgDuration: sql<number>`avg(duration_seconds) filter (where duration_seconds is not null)::int`,
    })
    .from(callsTable);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [todayCalls] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(callsTable)
    .where(gte(callsTable.createdAt, todayStart));

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  const [weekCalls] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(callsTable)
    .where(gte(callsTable.createdAt, weekStart));

  const [providerCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(providersTable);

  const totalCalls = callStats?.total ?? 0;
  const successfulCalls = callStats?.successful ?? 0;
  const successRate = totalCalls > 0 ? Math.round((successfulCalls / totalCalls) * 100) : 0;

  res.json(
    GetDashboardStatsResponse.parse({
      totalAgents: agentStats?.total ?? 0,
      activeAgents: agentStats?.active ?? 0,
      totalCalls,
      callsToday: todayCalls?.count ?? 0,
      successRate,
      avgDurationSeconds: callStats?.avgDuration ?? 0,
      callsThisWeek: weekCalls?.count ?? 0,
      totalProviders: providerCount?.count ?? 0,
    }),
  );
});

router.get("/analytics/calls/recent", async (req, res): Promise<void> => {
  const calls = await db
    .select({
      id: callsTable.id,
      agentId: callsTable.agentId,
      agentName: agentsTable.name,
      status: callsTable.status,
      toNumber: callsTable.toNumber,
      fromNumber: callsTable.fromNumber,
      durationSeconds: callsTable.durationSeconds,
      transcript: callsTable.transcript,
      recordingUrl: callsTable.recordingUrl,
      errorMessage: callsTable.errorMessage,
      metadata: callsTable.metadata,
      createdAt: callsTable.createdAt,
      endedAt: callsTable.endedAt,
    })
    .from(callsTable)
    .leftJoin(agentsTable, eq(callsTable.agentId, agentsTable.id))
    .orderBy(desc(callsTable.createdAt))
    .limit(20);

  const mapped = calls.map((c) => ({
    ...c,
    agentName: c.agentName ?? "Unknown Agent",
    createdAt: c.createdAt.toISOString(),
    endedAt: c.endedAt?.toISOString() ?? null,
  }));

  res.json(GetRecentCallsResponse.parse(mapped));
});

router.get("/analytics/calls/by-status", async (req, res): Promise<void> => {
  const rows = await db
    .select({
      status: callsTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(callsTable)
    .groupBy(callsTable.status);

  res.json(GetCallsByStatusResponse.parse(rows));
});

router.get("/analytics/calls/daily", async (req, res): Promise<void> => {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const rows = await db
    .select({
      date: sql<string>`to_char(created_at at time zone 'UTC', 'YYYY-MM-DD')`,
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where status = 'completed')::int`,
      failed: sql<number>`count(*) filter (where status = 'failed')::int`,
    })
    .from(callsTable)
    .where(gte(callsTable.createdAt, sevenDaysAgo))
    .groupBy(sql`to_char(created_at at time zone 'UTC', 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(created_at at time zone 'UTC', 'YYYY-MM-DD')`);

  res.json(GetDailyCallVolumeResponse.parse(rows));
});

/* ── GET /analytics/agents/:id ─────────────────────────────────────────── */

router.get("/analytics/agents/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetAgentStatsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const clerkId = (req as any).clerkUserId as string;
  const agentId = params.data.id;

  const [agent] = await db.select().from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkId)));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  const [totals] = await db.select({
    totalCalls:     sql<number>`count(*)::int`,
    successfulCalls: sql<number>`count(*) filter (where status = 'completed')::int`,
    failedCalls:    sql<number>`count(*) filter (where status = 'failed')::int`,
    avgDuration:    sql<number>`avg(duration_seconds) filter (where duration_seconds is not null)::int`,
    avgStt:         sql<number>`avg(stt_latency_ms) filter (where stt_latency_ms is not null)::int`,
    avgLlm:         sql<number>`avg(llm_latency_ms) filter (where llm_latency_ms is not null)::int`,
    avgTts:         sql<number>`avg(tts_first_chunk_ms) filter (where tts_first_chunk_ms is not null)::int`,
    totalSpend:     sql<number>`coalesce(sum(cost_cents), 0)::int`,
  }).from(callsTable).where(eq(callsTable.agentId, agentId));

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  const [{ weekCount }] = await db.select({ weekCount: sql<number>`count(*)::int` })
    .from(callsTable).where(and(eq(callsTable.agentId, agentId), gte(callsTable.createdAt, weekStart)));

  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const [{ monthCount }] = await db.select({ monthCount: sql<number>`count(*)::int` })
    .from(callsTable).where(and(eq(callsTable.agentId, agentId), gte(callsTable.createdAt, monthStart)));

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
  thirtyDaysAgo.setHours(0, 0, 0, 0);
  const daily = await db.select({
    date:      sql<string>`to_char(created_at at time zone 'UTC', 'YYYY-MM-DD')`,
    total:     sql<number>`count(*)::int`,
    completed: sql<number>`count(*) filter (where status = 'completed')::int`,
    failed:    sql<number>`count(*) filter (where status = 'failed')::int`,
  }).from(callsTable)
    .where(and(eq(callsTable.agentId, agentId), gte(callsTable.createdAt, thirtyDaysAgo)))
    .groupBy(sql`to_char(created_at at time zone 'UTC', 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(created_at at time zone 'UTC', 'YYYY-MM-DD')`);

  const [aiEvalRow] = await db.select({
    aiPass:      sql<number>`count(*) filter (where success_evaluation ilike 'PASS%')::int`,
    aiEvaluated: sql<number>`count(*) filter (where success_evaluation is not null)::int`,
  }).from(callsTable).where(eq(callsTable.agentId, agentId));

  const total = totals?.totalCalls ?? 0;
  const successful = totals?.successfulCalls ?? 0;
  const successRate = total > 0 ? Math.round((successful / total) * 100) : 0;
  const aiEvaluated = aiEvalRow?.aiEvaluated ?? 0;
  const aiPassCount = aiEvalRow?.aiPass ?? 0;
  const aiPassRate = aiEvaluated > 0 ? Math.round((aiPassCount / aiEvaluated) * 100) : null;

  res.json(GetAgentStatsResponse.parse({
    agentId,
    name: agent.name,
    totalCalls: total,
    successfulCalls: successful,
    failedCalls: totals?.failedCalls ?? 0,
    successRate,
    aiEvaluatedCalls: aiEvaluated,
    aiPassRate,
    avgDurationSeconds: totals?.avgDuration ?? null,
    avgSttLatencyMs: totals?.avgStt ?? null,
    avgLlmLatencyMs: totals?.avgLlm ?? null,
    avgTtsFirstChunkMs: totals?.avgTts ?? null,
    callsThisWeek: weekCount ?? 0,
    callsThisMonth: monthCount ?? 0,
    totalSpendCents: totals?.totalSpend ?? 0,
    dailyVolume: daily,
  }));
});

export default router;

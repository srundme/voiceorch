import { Router, type IRouter } from "express";
import { desc, sql, eq, gte } from "drizzle-orm";
import { db, callsTable, agentsTable, providersTable } from "@workspace/db";
import {
  GetDashboardStatsResponse,
  GetRecentCallsResponse,
  GetCallsByStatusResponse,
  GetDailyCallVolumeResponse,
} from "@workspace/api-zod";

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

export default router;

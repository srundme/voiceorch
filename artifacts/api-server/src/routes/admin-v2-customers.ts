/**
 * Admin V2 Phase 5 — Customer ops: enriched users, User 360, workspaces, agent economics.
 */
import { Router } from "express";
import {
  db,
  usersTable,
  walletTransactionsTable,
  usageEventsTable,
  callsTable,
  agentsTable,
  phoneNumbersTable,
  platformSettingsTable,
  activityLogsTable,
} from "@workspace/db";
import { and, desc, eq, sql, count } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { logger } from "../lib/logger.js";

const router = Router();
router.use("/admin/customers", requireAdmin);
router.use("/admin/users", requireAdmin);
router.use("/admin/agents", requireAdmin);

async function usdToInrRate(): Promise<number> {
  try {
    const [row] = await db
      .select()
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "vobiz_usd_to_inr_rate"))
      .limit(1);
    const n = Number(row?.value ?? 96);
    return Number.isFinite(n) && n > 0 ? n : 96;
  } catch {
    return 96;
  }
}

function microsToPaise(micros: number, rate: number) {
  return Math.round((micros / 1_000_000) * rate * 100);
}

// ─── Enriched users directory ────────────────────────────────────────────────

router.get("/admin/customers/users", async (req, res): Promise<void> => {
  try {
    const filter = String(req.query.filter ?? "all"); // all | active | suspended | paying | dormant | high_usage
    const dormantDays = Number(req.query.dormantDays ?? 30);

    const users = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));
    if (users.length === 0) {
      res.json({ users: [], generatedAt: new Date().toISOString() });
      return;
    }

    const [callAgg, agentCounts, revenue, lastActive, cost] = await Promise.all([
      db
        .select({
          clerkId: callsTable.userId,
          callCount: count(),
          minutes: sql<number>`round(coalesce(sum(${callsTable.durationSeconds}), 0) / 60.0, 2)`,
        })
        .from(callsTable)
        .groupBy(callsTable.userId),
      db
        .select({ clerkId: agentsTable.userId, agentCount: count() })
        .from(agentsTable)
        .groupBy(agentsTable.userId),
      db
        .select({
          userId: walletTransactionsTable.userId,
          revenuePaise: sql<number>`coalesce(sum(abs(${walletTransactionsTable.amountCents})), 0)`,
        })
        .from(walletTransactionsTable)
        .where(eq(walletTransactionsTable.type, "call_debit"))
        .groupBy(walletTransactionsTable.userId),
      db
        .select({
          clerkId: callsTable.userId,
          lastActiveAt: sql<string>`max(${callsTable.createdAt})`,
        })
        .from(callsTable)
        .groupBy(callsTable.userId),
      db
        .select({
          userId: usageEventsTable.userId,
          costMicros: sql<number>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
        })
        .from(usageEventsTable)
        .groupBy(usageEventsTable.userId),
    ]);

    const callMap = new Map(callAgg.map((r) => [r.clerkId, r]));
    const agentMap = new Map(agentCounts.map((r) => [r.clerkId, r.agentCount]));
    const revMap = new Map(revenue.map((r) => [r.userId, Number(r.revenuePaise)]));
    const lastMap = new Map(lastActive.map((r) => [r.clerkId, r.lastActiveAt]));
    const costMap = new Map(cost.map((r) => [r.userId, Number(r.costMicros)]));
    const fx = await usdToInrRate();
    const dormantCutoff = Date.now() - dormantDays * 86400000;

    let rows = users.map((u) => {
      const c = callMap.get(u.clerkId);
      const last = lastMap.get(u.clerkId);
      const lastMs = last ? new Date(last).getTime() : 0;
      const revenuePaise = revMap.get(u.id) ?? 0;
      const costPaise = microsToPaise(costMap.get(u.clerkId) ?? 0, fx);
      const callCount = Number(c?.callCount ?? 0);
      let lifecycle = "new";
      if (u.status === "suspended") lifecycle = "suspended";
      else if (u.status === "deleted") lifecycle = "deleted";
      else if (revenuePaise > 0) lifecycle = "paying";
      else if (callCount > 0 && lastMs >= dormantCutoff) lifecycle = "active";
      else if (callCount > 0 && lastMs < dormantCutoff) lifecycle = "dormant";
      else if (u.createdAt && Date.now() - new Date(u.createdAt).getTime() < 7 * 86400000) lifecycle = "new";
      else lifecycle = "dormant";

      return {
        id: u.id,
        clerkId: u.clerkId,
        email: u.email,
        name: u.name,
        status: u.status,
        isTest: u.isTest,
        walletBalanceCents: u.walletBalanceCents,
        onboardingData: u.onboardingData,
        agentCount: agentMap.get(u.clerkId) ?? 0,
        callCount,
        minutes: Number(c?.minutes ?? 0),
        revenuePaise,
        costPaise,
        profitPaise: revenuePaise - costPaise,
        lastActiveAt: last ?? null,
        lifecycle,
        createdAt: u.createdAt,
      };
    });

    if (filter === "active") rows = rows.filter((r) => r.lifecycle === "active" || r.lifecycle === "paying");
    else if (filter === "suspended") rows = rows.filter((r) => r.status === "suspended");
    else if (filter === "paying") rows = rows.filter((r) => r.lifecycle === "paying");
    else if (filter === "dormant") rows = rows.filter((r) => r.lifecycle === "dormant");
    else if (filter === "high_usage") rows = rows.filter((r) => r.minutes >= 60).sort((a, b) => b.minutes - a.minutes);
    else if (filter === "high_value") rows = [...rows].sort((a, b) => b.revenuePaise - a.revenuePaise).slice(0, 100);

    res.json({ users: rows, generatedAt: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "customers/users failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── User 360 SaaS strip + timeline ──────────────────────────────────────────

router.get("/admin/users/:clerkId/360", async (req, res): Promise<void> => {
  try {
    const clerkId = String(req.params.clerkId);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const fx = await usdToInrRate();
    const [
      [callStats],
      [rev],
      [cost],
      [agentCount],
      [configuredCount],
      [hasNumber],
      [firstAgent],
      [firstCall],
      [firstPaid],
      [lastCall],
      activity,
    ] = await Promise.all([
      db
        .select({
          calls: count(),
          minutes: sql<number>`round(coalesce(sum(${callsTable.durationSeconds}), 0) / 60.0, 2)`,
          successful: sql<number>`count(*) filter (where lower(coalesce(${callsTable.status},'')) in ('completed','success','ended'))`,
        })
        .from(callsTable)
        .where(eq(callsTable.userId, clerkId)),
      db
        .select({
          paise: sql<number>`coalesce(sum(abs(${walletTransactionsTable.amountCents})), 0)`,
        })
        .from(walletTransactionsTable)
        .where(and(eq(walletTransactionsTable.userId, user.id), eq(walletTransactionsTable.type, "call_debit"))),
      db
        .select({
          micros: sql<number>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
        })
        .from(usageEventsTable)
        .where(eq(usageEventsTable.userId, clerkId)),
      db.select({ c: count() }).from(agentsTable).where(eq(agentsTable.userId, clerkId)),
      db
        .select({ c: count() })
        .from(agentsTable)
        .where(and(
          eq(agentsTable.userId, clerkId),
          sql`length(coalesce(${agentsTable.systemPrompt}, '')) > 40`,
        )),
      db.select({ c: count() }).from(phoneNumbersTable).where(eq(phoneNumbersTable.userId, clerkId)),
      db
        .select({ at: sql<string>`min(${agentsTable.createdAt})` })
        .from(agentsTable)
        .where(eq(agentsTable.userId, clerkId)),
      db
        .select({ at: sql<string>`min(${callsTable.createdAt})` })
        .from(callsTable)
        .where(eq(callsTable.userId, clerkId)),
      db
        .select({ at: sql<string>`min(${walletTransactionsTable.createdAt})` })
        .from(walletTransactionsTable)
        .where(and(eq(walletTransactionsTable.userId, user.id), eq(walletTransactionsTable.type, "call_debit"))),
      db
        .select({ at: sql<string>`max(${callsTable.createdAt})` })
        .from(callsTable)
        .where(eq(callsTable.userId, clerkId)),
      db
        .select({
          eventType: activityLogsTable.eventType,
          description: activityLogsTable.description,
          createdAt: activityLogsTable.createdAt,
        })
        .from(activityLogsTable)
        .where(eq(activityLogsTable.userId, clerkId))
        .orderBy(desc(activityLogsTable.createdAt))
        .limit(30),
    ]);

    const revenuePaise = Number(rev?.paise ?? 0);
    const costPaise = microsToPaise(Number(cost?.micros ?? 0), fx);
    const agents = Number(agentCount?.c ?? 0);
    const configured = Number(configuredCount?.c ?? 0) > 0;
    const numbers = Number(hasNumber?.c ?? 0);
    const calls = Number(callStats?.calls ?? 0);
    const successful = Number(callStats?.successful ?? 0);

    let activation = "Incomplete";
    if (agents > 0 && configured && successful > 0) activation = "Complete";
    else if (agents > 0) activation = "In progress";

    let lifecycle = "New";
    if (user.status === "suspended") lifecycle = "Suspended";
    else if (user.status === "deleted") lifecycle = "Deleted";
    else if (revenuePaise > 0) lifecycle = "Paying";
    else if (calls > 0) lifecycle = "Active";
    else lifecycle = "Signed up";

    const signupAt = user.createdAt
      ? (user.createdAt instanceof Date ? user.createdAt.toISOString() : String(user.createdAt))
      : null;
    const timeline: Array<{ stage: string; at: string | null; done: boolean }> = [
      { stage: "Signup", at: signupAt, done: true },
      { stage: "Agent created", at: firstAgent?.at ? String(firstAgent.at) : null, done: !!firstAgent?.at },
      { stage: "Agent configured", at: configured && firstAgent?.at ? String(firstAgent.at) : null, done: configured },
      { stage: "Number purchased", at: numbers > 0 ? signupAt : null, done: numbers > 0 },
      { stage: "First call", at: firstCall?.at ? String(firstCall.at) : null, done: !!firstCall?.at },
      { stage: "Paid usage", at: firstPaid?.at ? String(firstPaid.at) : null, done: !!firstPaid?.at },
    ];

    res.json({
      clerkId,
      generatedAt: new Date().toISOString(),
      saas: {
        activation,
        lifecycle,
        lastActiveAt: lastCall?.at ?? null,
        lifetimeRevenuePaise: revenuePaise,
        lifetimeCostPaise: costPaise,
        lifetimeProfitPaise: revenuePaise - costPaise,
        calls,
        minutes: Number(callStats?.minutes ?? 0),
        agents,
        numbers,
      },
      timeline,
      recentActivity: activity,
    });
  } catch (err) {
    logger.error({ err }, "users/360 failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Workspaces (1:1 with users today) ───────────────────────────────────────

router.get("/admin/customers/workspaces", async (req, res): Promise<void> => {
  try {
    const { from, to } = (() => {
      const toD = req.query.to ? new Date(String(req.query.to)) : new Date();
      const fromD = req.query.from
        ? new Date(String(req.query.from))
        : new Date(toD.getTime() - 30 * 86400000);
      if (String(req.query.to ?? "").length <= 10) toD.setHours(23, 59, 59, 999);
      return { from: fromD, to: toD };
    })();
    const fx = await usdToInrRate();

    const result = await db.execute(sql`
      select
        u.clerk_id as workspace_id,
        u.name as owner_name,
        u.email as owner_email,
        u.status,
        u.is_test,
        (select count(*) from agents a where a.user_id = u.clerk_id)::int as agents,
        (select count(*) from calls c
          where c.user_id = u.clerk_id and c.created_at >= ${from} and c.created_at <= ${to})::int as calls,
        round(coalesce((
          select sum(c.duration_seconds) from calls c
          where c.user_id = u.clerk_id and c.created_at >= ${from} and c.created_at <= ${to}
        ), 0) / 60.0, 2) as minutes,
        coalesce((
          select sum(abs(wt.amount_cents)) from wallet_transactions wt
          where wt.user_id = u.id and wt.type = 'call_debit'
            and wt.created_at >= ${from} and wt.created_at <= ${to}
        ), 0)::bigint as revenue_paise,
        coalesce((
          select sum(ue.estimated_cost_micros) from usage_events ue
          where ue.user_id = u.clerk_id
            and ue.created_at >= ${from} and ue.created_at <= ${to}
        ), 0)::bigint as cost_micros,
        u.wallet_balance_cents as wallet_paise,
        u.created_at
      from users u
      where coalesce(u.is_test, false) = false
        and u.status <> 'deleted'
      order by revenue_paise desc nulls last
      limit 200
    `);

    const workspaces = (result.rows as Array<Record<string, unknown>>).map((r) => {
      const revenue = Number(r.revenue_paise ?? 0);
      const cost = microsToPaise(Number(r.cost_micros ?? 0), fx);
      return {
        workspaceId: String(r.workspace_id),
        ownerName: r.owner_name ? String(r.owner_name) : null,
        ownerEmail: r.owner_email ? String(r.owner_email) : null,
        status: String(r.status ?? "active"),
        agents: Number(r.agents ?? 0),
        users: 1,
        calls: Number(r.calls ?? 0),
        minutes: Number(r.minutes ?? 0),
        revenuePaise: revenue,
        costPaise: cost,
        profitPaise: revenue - cost,
        walletPaise: Number(r.wallet_paise ?? 0),
        createdAt: r.created_at,
      };
    });

    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      generatedAt: new Date().toISOString(),
      note: "SnapServe workspaces currently map 1:1 to owner accounts.",
      workspaces,
    });
  } catch (err) {
    logger.error({ err }, "customers/workspaces failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Agent 360 economics ─────────────────────────────────────────────────────

router.get("/admin/agents/:agentId/360", async (req, res): Promise<void> => {
  try {
    const agentId = Number(req.params.agentId);
    if (!Number.isFinite(agentId)) {
      res.status(400).json({ error: "Invalid agent id" });
      return;
    }
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId)).limit(1);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const days = Math.min(90, Math.max(7, Number(req.query.days ?? 30)));
    const from = new Date(Date.now() - days * 86400000);
    const fx = await usdToInrRate();

    const stats = await db.execute(sql`
      select
        count(c.id)::int as calls,
        round(coalesce(sum(c.duration_seconds), 0) / 60.0, 2) as minutes,
        avg(c.duration_seconds) as avg_duration,
        count(c.id) filter (
          where lower(coalesce(c.status,'')) in ('completed','success','ended')
        )::int as successful,
        count(c.id) filter (
          where coalesce(c.error_message,'') <> ''
        )::int as failed,
        coalesce((
          select sum(abs(wt.amount_cents)) from wallet_transactions wt
          where wt.type = 'call_debit' and wt.call_id in (
            select c2.id from calls c2 where c2.agent_id = ${agentId} and c2.created_at >= ${from}
          )
        ), 0)::bigint as revenue_paise,
        coalesce((
          select sum(ue.estimated_cost_micros) from usage_events ue
          where ue.call_id in (
            select c2.id from calls c2 where c2.agent_id = ${agentId} and c2.created_at >= ${from}
          )
        ), 0)::bigint as cost_micros,
        avg(c.stt_latency_ms) as avg_stt_ms,
        avg(c.llm_latency_ms) as avg_llm_ms,
        avg(c.tts_first_chunk_ms) as avg_tts_ms
      from calls c
      where c.agent_id = ${agentId} and c.created_at >= ${from}
    `);

    const r = (stats.rows[0] ?? {}) as Record<string, unknown>;
    const calls = Number(r.calls ?? 0);
    const successful = Number(r.successful ?? 0);
    const failed = Number(r.failed ?? 0);
    const revenue = Number(r.revenue_paise ?? 0);
    const cost = microsToPaise(Number(r.cost_micros ?? 0), fx);

    res.json({
      agentId,
      name: agent.name,
      ownerId: agent.userId,
      createdAt: agent.createdAt,
      language: agent.language,
      voice: agent.ttsVoiceName ?? agent.ttsVoice,
      asrProvider: agent.asrProvider,
      llmProvider: agent.llmProvider,
      ttsProvider: agent.ttsProvider,
      days,
      economics: {
        revenuePaise: revenue,
        costPaise: cost,
        profitPaise: revenue - cost,
        marginPct: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : 0,
      },
      usage: {
        calls,
        minutes: Number(r.minutes ?? 0),
        avgDurationSeconds: r.avg_duration != null ? Math.round(Number(r.avg_duration)) : null,
      },
      quality: {
        successRatePct: calls > 0 ? Math.round((successful / calls) * 1000) / 10 : 0,
        failureRatePct: calls > 0 ? Math.round((failed / calls) * 1000) / 10 : 0,
        avgSttMs: r.avg_stt_ms != null ? Math.round(Number(r.avg_stt_ms)) : null,
        avgLlmMs: r.avg_llm_ms != null ? Math.round(Number(r.avg_llm_ms)) : null,
        avgTtsMs: r.avg_tts_ms != null ? Math.round(Number(r.avg_tts_ms)) : null,
      },
    });
  } catch (err) {
    logger.error({ err }, "agents/360 failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

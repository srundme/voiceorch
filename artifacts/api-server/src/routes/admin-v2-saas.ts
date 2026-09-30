/**
 * Admin V2 Phase 3 — SaaS analytics: users, activation, retention, agents, providers.
 */
import { Router, type Request } from "express";
import {
  db,
  usersTable,
  walletTransactionsTable,
  usageEventsTable,
  callsTable,
  platformSettingsTable,
} from "@workspace/db";
import { eq, sql, and, gte, lte, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";

const router = Router();
router.use("/admin/analytics", requireAdmin);

function parseRange(req: Request): { from: Date; to: Date } {
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const from = req.query.from
    ? new Date(String(req.query.from))
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error("Invalid from/to date");
  }
  const toAdj = new Date(to);
  if (String(req.query.to ?? "").length <= 10) toAdj.setHours(23, 59, 59, 999);
  const fromAdj = new Date(from);
  if (String(req.query.from ?? "").length <= 10) fromAdj.setHours(0, 0, 0, 0);
  return { from: fromAdj, to: toAdj };
}

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

function microsUsdToPaise(micros: number, rate: number): number {
  return Math.round((micros / 1_000_000) * rate * 100);
}

// ─── User growth ─────────────────────────────────────────────────────────────

router.get("/admin/analytics/users", async (req, res): Promise<void> => {
  try {
    const { from, to } = parseRange(req);
    const dormantDays = Number(req.query.dormantDays ?? 30);
    const churnDays = Number(req.query.churnDays ?? 60);

    const [
      [signups],
      activated,
      [active],
      [paying],
      returning,
      churned,
      dormant,
      signupSeries,
      lifecycleSeries,
    ] = await Promise.all([
      db
        .select({ c: sql<number>`count(*)` })
        .from(usersTable)
        .where(
          and(
            gte(usersTable.createdAt, from),
            lte(usersTable.createdAt, to),
            sql`coalesce(${usersTable.isTest}, false) = false`,
          ),
        ),
      // Activated: signup in range + has agent + has successful-ish call
      db.execute(sql`
        select count(*)::int as c from users u
        where u.created_at >= ${from} and u.created_at <= ${to}
          and coalesce(u.is_test, false) = false
          and exists (select 1 from agents a where a.user_id = u.clerk_id)
          and exists (
            select 1 from calls c
            where c.user_id = u.clerk_id
              and lower(coalesce(c.status,'')) in ('completed','success','ended')
          )
      `),
      db
        .select({ c: sql<number>`count(distinct ${callsTable.userId})` })
        .from(callsTable)
        .where(and(gte(callsTable.createdAt, from), lte(callsTable.createdAt, to))),
      db
        .select({ c: sql<number>`count(distinct ${walletTransactionsTable.userId})` })
        .from(walletTransactionsTable)
        .where(
          and(
            gte(walletTransactionsTable.createdAt, from),
            lte(walletTransactionsTable.createdAt, to),
            eq(walletTransactionsTable.type, "call_debit"),
          ),
        ),
      // Returning: active in range AND also had a call before range
      db.execute(sql`
        select count(*)::int as c from (
          select distinct c.user_id
          from calls c
          where c.created_at >= ${from} and c.created_at <= ${to} and c.user_id is not null
          intersect
          select distinct c2.user_id
          from calls c2
          where c2.created_at < ${from} and c2.user_id is not null
        ) t
      `),
      // Churned: had call activity before range, none in last churnDays
      db.execute(sql`
        select count(*)::int as c from (
          select distinct user_id from calls
          where created_at < ${from} and user_id is not null
        ) prior
        where not exists (
          select 1 from calls c
          where c.user_id = prior.user_id
            and c.created_at >= now() - (${churnDays} || ' days')::interval
        )
      `),
      db.execute(sql`
        select count(*)::int as c from users u
        where coalesce(u.is_test, false) = false
          and u.status = 'active'
          and not exists (
            select 1 from calls c
            where c.user_id = u.clerk_id
              and c.created_at >= now() - (${dormantDays} || ' days')::interval
          )
      `),
      db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${usersTable.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
          count: sql<number>`count(*)`,
        })
        .from(usersTable)
        .where(
          and(
            gte(usersTable.createdAt, from),
            lte(usersTable.createdAt, to),
            sql`coalesce(${usersTable.isTest}, false) = false`,
          ),
        )
        .groupBy(sql`1`)
        .orderBy(sql`1`),
      db.execute(sql`
        select
          to_char(d.day, 'YYYY-MM-DD') as day,
          (select count(*) from users u
            where date_trunc('day', u.created_at AT TIME ZONE 'UTC') = d.day
              and coalesce(u.is_test, false) = false) as signups,
          (select count(distinct c.user_id) from calls c
            where date_trunc('day', c.created_at AT TIME ZONE 'UTC') = d.day) as active,
          (select count(distinct wt.user_id) from wallet_transactions wt
            where wt.type = 'call_debit'
              and date_trunc('day', wt.created_at AT TIME ZONE 'UTC') = d.day) as paying
        from generate_series(
          date_trunc('day', ${from}::timestamptz),
          date_trunc('day', ${to}::timestamptz),
          interval '1 day'
        ) as d(day)
        order by d.day
      `),
    ]);

    const activatedCount = Number((activated.rows[0] as { c?: number } | undefined)?.c ?? 0);
    const returningCount = Number((returning.rows[0] as { c?: number } | undefined)?.c ?? 0);
    const churnedCount = Number((churned.rows[0] as { c?: number } | undefined)?.c ?? 0);
    const dormantCount = Number((dormant.rows[0] as { c?: number } | undefined)?.c ?? 0);
    const newSignups = Number(signups?.c ?? 0);

    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      generatedAt: new Date().toISOString(),
      definitions: {
        newSignups: "Users created in range (excludes is_test)",
        activated: "Signups in range with agent + completed call",
        active: "Distinct users with a call in range",
        paying: "Distinct users with call_debit in range",
        returning: "Active in range and also called before range",
        churned: `Had calls before range, none in last ${churnDays} days`,
        dormant: `Active accounts with no calls in last ${dormantDays} days`,
      },
      kpis: {
        newSignups,
        activated: activatedCount,
        active: Number(active?.c ?? 0),
        paying: Number(paying?.c ?? 0),
        returning: returningCount,
        churned: churnedCount,
        dormant: dormantCount,
        activationRatePct: newSignups > 0 ? Math.round((activatedCount / newSignups) * 1000) / 10 : 0,
      },
      signupSeries: signupSeries.map((r) => ({ date: r.day, count: Number(r.count) })),
      lifecycleSeries: (lifecycleSeries.rows as Array<Record<string, unknown>>).map((r) => ({
        date: String(r.day),
        signups: Number(r.signups ?? 0),
        active: Number(r.active ?? 0),
        paying: Number(r.paying ?? 0),
      })),
      funnel: [
        { stage: "Signups", users: newSignups },
        { stage: "Activated", users: activatedCount },
        { stage: "Active", users: Number(active?.c ?? 0) },
        { stage: "Paying", users: Number(paying?.c ?? 0) },
      ],
    });
  } catch (err) {
    req.log?.error({ err }, "admin/analytics/users failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ─── Activation funnel ───────────────────────────────────────────────────────

router.get("/admin/analytics/activation", async (req, res): Promise<void> => {
  try {
    const { from, to } = parseRange(req);
    const result = await db.execute(sql`
      with cohort as (
        select clerk_id, created_at
        from users
        where created_at >= ${from} and created_at <= ${to}
          and coalesce(is_test, false) = false
      ),
      stages as (
        select
          (select count(*) from cohort) as signup,
          (select count(*) from cohort c where exists (
            select 1 from agents a where a.user_id = c.clerk_id
          )) as created_agent,
          (select count(*) from cohort c where exists (
            select 1 from agents a
            where a.user_id = c.clerk_id
              and length(coalesce(a.system_prompt,'')) > 40
          )) as configured_agent,
          (select count(*) from cohort c where exists (
            select 1 from phone_numbers pn where pn.user_id = c.clerk_id
          )) as purchased_number,
          (select count(*) from cohort c where exists (
            select 1 from calls cl where cl.user_id = c.clerk_id
          )) as first_call,
          (select count(*) from cohort c where exists (
            select 1 from calls cl
            where cl.user_id = c.clerk_id
              and lower(coalesce(cl.status,'')) in ('completed','success','ended')
          )) as successful_call,
          (select count(*) from cohort c where (
            select count(*) from calls cl where cl.user_id = c.clerk_id
          ) >= 5) as five_plus_calls,
          (select count(*) from cohort c where exists (
            select 1 from wallet_transactions wt
            join users u on u.id = wt.user_id
            where u.clerk_id = c.clerk_id and wt.type = 'call_debit'
          )) as paid
      ),
      medians as (
        select
          percentile_cont(0.5) within group (order by extract(epoch from (fa.first_agent - c.created_at))/3600)
            as median_hours_to_agent,
          percentile_cont(0.5) within group (order by extract(epoch from (fc.first_call - c.created_at))/3600)
            as median_hours_to_first_call,
          percentile_cont(0.5) within group (order by extract(epoch from (fp.first_paid - c.created_at))/3600)
            as median_hours_to_paid
        from cohort c
        left join lateral (
          select min(a.created_at) as first_agent from agents a where a.user_id = c.clerk_id
        ) fa on true
        left join lateral (
          select min(cl.created_at) as first_call from calls cl where cl.user_id = c.clerk_id
        ) fc on true
        left join lateral (
          select min(wt.created_at) as first_paid
          from wallet_transactions wt
          join users u on u.id = wt.user_id
          where u.clerk_id = c.clerk_id and wt.type = 'call_debit'
        ) fp on true
      )
      select stages.*, medians.* from stages, medians
    `);

    const row = (result.rows[0] ?? {}) as Record<string, unknown>;
    const stageDefs = [
      { key: "signup", label: "Signup" },
      { key: "created_agent", label: "Created Agent" },
      { key: "configured_agent", label: "Configured Agent" },
      { key: "purchased_number", label: "Purchased Number" },
      { key: "first_call", label: "First Call" },
      { key: "successful_call", label: "Successful Call" },
      { key: "five_plus_calls", label: "5+ Calls" },
      { key: "paid", label: "Paid" },
    ] as const;

    const stages = stageDefs.map((s, i) => {
      const users = Number(row[s.key] ?? 0);
      const prev = i === 0 ? users : Number(row[stageDefs[i - 1]!.key] ?? 0);
      const conversionPct = prev > 0 ? Math.round((users / prev) * 1000) / 10 : 0;
      const dropoffPct = prev > 0 ? Math.round(((prev - users) / prev) * 1000) / 10 : 0;
      return { stage: s.label, users, conversionPct, dropoffPct };
    });

    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      generatedAt: new Date().toISOString(),
      stages,
      speed: {
        medianHoursToAgent: row.median_hours_to_agent != null ? Number(row.median_hours_to_agent) : null,
        medianHoursToFirstCall: row.median_hours_to_first_call != null ? Number(row.median_hours_to_first_call) : null,
        medianHoursToPaid: row.median_hours_to_paid != null ? Number(row.median_hours_to_paid) : null,
      },
    });
  } catch (err) {
    req.log?.error({ err }, "admin/analytics/activation failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ─── Retention cohorts (weekly) ──────────────────────────────────────────────

router.get("/admin/analytics/retention", async (req, res): Promise<void> => {
  try {
    const weeks = Math.min(12, Math.max(4, Number(req.query.weeks ?? 8)));
    const result = await db.execute(sql`
      with signups as (
        select clerk_id, date_trunc('week', created_at AT TIME ZONE 'UTC')::date as cohort_week
        from users
        where coalesce(is_test, false) = false
          and created_at >= date_trunc('week', now() AT TIME ZONE 'UTC') - (${weeks} || ' weeks')::interval
      ),
      activity as (
        select distinct user_id, date_trunc('week', created_at AT TIME ZONE 'UTC')::date as act_week
        from calls
        where user_id is not null
          and created_at >= date_trunc('week', now() AT TIME ZONE 'UTC') - (${weeks + 8} || ' weeks')::interval
      ),
      matrix as (
        select
          s.cohort_week,
          greatest(0, (extract(epoch from (a.act_week - s.cohort_week)) / 604800)::int) as week_n,
          count(distinct s.clerk_id) as users
        from signups s
        left join activity a on a.user_id = s.clerk_id and a.act_week >= s.cohort_week
        group by s.cohort_week, week_n
      ),
      sizes as (
        select cohort_week, count(*)::int as cohort_size from signups group by cohort_week
      )
      select m.cohort_week, m.week_n, m.users, s.cohort_size
      from matrix m
      join sizes s on s.cohort_week = m.cohort_week
      where m.week_n is not null and m.week_n <= 8
      order by m.cohort_week, m.week_n
    `);

    const byCohort = new Map<string, { cohortWeek: string; size: number; weeks: Record<number, number> }>();
    for (const r of result.rows as Array<Record<string, unknown>>) {
      const key = String(r.cohort_week).slice(0, 10);
      const weekN = Number(r.week_n);
      const size = Number(r.cohort_size ?? 0);
      const users = Number(r.users ?? 0);
      if (!byCohort.has(key)) byCohort.set(key, { cohortWeek: key, size, weeks: {} });
      const row = byCohort.get(key)!;
      row.weeks[weekN] = size > 0 ? Math.round((users / size) * 1000) / 10 : 0;
    }

    const cohorts = [...byCohort.values()].sort((a, b) => a.cohortWeek.localeCompare(b.cohortWeek));

    // D1 / D7 / D30 rough from recent signups
    const kpis = await db.execute(sql`
      with recent as (
        select clerk_id, created_at from users
        where coalesce(is_test, false) = false
          and created_at >= now() - interval '45 days'
      )
      select
        (select count(*) from recent) as cohort,
        (select count(*) from recent r where exists (
          select 1 from calls c where c.user_id = r.clerk_id
            and c.created_at >= r.created_at and c.created_at < r.created_at + interval '1 day'
        )) as d1,
        (select count(*) from recent r where exists (
          select 1 from calls c where c.user_id = r.clerk_id
            and c.created_at >= r.created_at and c.created_at < r.created_at + interval '7 days'
        )) as d7,
        (select count(*) from recent r where exists (
          select 1 from calls c where c.user_id = r.clerk_id
            and c.created_at >= r.created_at and c.created_at < r.created_at + interval '30 days'
        )) as d30
    `);
    const k = (kpis.rows[0] ?? {}) as Record<string, unknown>;
    const cohortN = Number(k.cohort ?? 0) || 1;

    res.json({
      generatedAt: new Date().toISOString(),
      kpis: {
        d1RetentionPct: Math.round((Number(k.d1 ?? 0) / cohortN) * 1000) / 10,
        d7RetentionPct: Math.round((Number(k.d7 ?? 0) / cohortN) * 1000) / 10,
        d30RetentionPct: Math.round((Number(k.d30 ?? 0) / cohortN) * 1000) / 10,
      },
      cohorts,
    });
  } catch (err) {
    req.log?.error({ err }, "admin/analytics/retention failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ─── Agent analytics ─────────────────────────────────────────────────────────

router.get("/admin/analytics/agents", async (req, res): Promise<void> => {
  try {
    const { from, to } = parseRange(req);
    const fx = await usdToInrRate();
    const limit = Math.min(100, Math.max(10, Number(req.query.limit ?? 50)));

    const [totals, top] = await Promise.all([
      db.execute(sql`
        select
          (select count(*) from agents) as total_agents,
          (select count(distinct agent_id) from calls
            where created_at >= ${from} and created_at <= ${to}) as active_agents,
          (select count(*) from agents
            where created_at >= ${from} and created_at <= ${to}) as new_agents
      `),
      db.execute(sql`
        select
          a.id as agent_id,
          a.name as agent_name,
          a.user_id as owner_id,
          u.email as owner_email,
          u.name as owner_name,
          count(c.id)::int as calls,
          round(coalesce(sum(c.duration_seconds), 0) / 60.0, 2) as minutes,
          coalesce(sum(abs(wt.amount_cents)), 0)::bigint as revenue_paise,
          coalesce((
            select sum(ue.estimated_cost_micros)
            from usage_events ue
            where ue.call_id in (
              select c2.id from calls c2
              where c2.agent_id = a.id
                and c2.created_at >= ${from} and c2.created_at <= ${to}
            )
          ), 0)::bigint as cost_micros,
          count(c.id) filter (
            where lower(coalesce(c.status,'')) not in ('completed','success','ended')
              and coalesce(c.error_message,'') <> ''
          )::int as failed_calls
        from agents a
        left join users u on u.clerk_id = a.user_id
        left join calls c on c.agent_id = a.id
          and c.created_at >= ${from} and c.created_at <= ${to}
        left join wallet_transactions wt on wt.call_id = c.id and wt.type = 'call_debit'
        group by a.id, a.name, a.user_id, u.email, u.name
        having count(c.id) > 0
        order by count(c.id) desc
        limit ${limit}
      `),
    ]);

    const t = (totals.rows[0] ?? {}) as Record<string, unknown>;
    const agents = (top.rows as Array<Record<string, unknown>>).map((r) => {
      const revenue = Number(r.revenue_paise ?? 0);
      const cost = microsUsdToPaise(Number(r.cost_micros ?? 0), fx);
      const calls = Number(r.calls ?? 0);
      const failed = Number(r.failed_calls ?? 0);
      return {
        agentId: Number(r.agent_id),
        agentName: String(r.agent_name ?? ""),
        ownerId: r.owner_id ? String(r.owner_id) : null,
        ownerEmail: r.owner_email ? String(r.owner_email) : null,
        ownerName: r.owner_name ? String(r.owner_name) : null,
        calls,
        minutes: Number(r.minutes ?? 0),
        revenuePaise: revenue,
        costPaise: cost,
        profitPaise: revenue - cost,
        failureRatePct: calls > 0 ? Math.round((failed / calls) * 1000) / 10 : 0,
      };
    });

    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      generatedAt: new Date().toISOString(),
      kpis: {
        totalAgents: Number(t.total_agents ?? 0),
        activeAgents: Number(t.active_agents ?? 0),
        newAgents: Number(t.new_agents ?? 0),
      },
      agents,
    });
  } catch (err) {
    req.log?.error({ err }, "admin/analytics/agents failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ─── Provider analytics ──────────────────────────────────────────────────────

router.get("/admin/analytics/providers", async (req, res): Promise<void> => {
  try {
    const { from, to } = parseRange(req);
    const fx = await usdToInrRate();

    const rows = await db
      .select({
        service: usageEventsTable.service,
        provider: usageEventsTable.provider,
        events: sql<number>`count(*)`,
        failures: sql<number>`count(*) filter (where ${usageEventsTable.success} = false)`,
        audioSeconds: sql<number>`coalesce(sum(${usageEventsTable.audioSeconds}), 0)`,
        inputTokens: sql<number>`coalesce(sum(${usageEventsTable.inputTokens}), 0)`,
        outputTokens: sql<number>`coalesce(sum(${usageEventsTable.outputTokens}), 0)`,
        characters: sql<number>`coalesce(sum(${usageEventsTable.characters}), 0)`,
        costMicros: sql<number>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
        avgLatencyMs: sql<number>`avg(${usageEventsTable.latencyMs})`,
      })
      .from(usageEventsTable)
      .where(and(gte(usageEventsTable.createdAt, from), lte(usageEventsTable.createdAt, to)))
      .groupBy(usageEventsTable.service, usageEventsTable.provider)
      .orderBy(desc(sql`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`));

    const providers = rows.map((r) => {
      const events = Number(r.events ?? 0);
      const failures = Number(r.failures ?? 0);
      const costPaise = microsUsdToPaise(Number(r.costMicros ?? 0), fx);
      const minutes = Number(r.audioSeconds ?? 0) / 60;
      return {
        service: r.service,
        provider: r.provider,
        events,
        failures,
        failureRatePct: events > 0 ? Math.round((failures / events) * 1000) / 10 : 0,
        minutes: Math.round(minutes * 100) / 100,
        tokens: Number(r.inputTokens ?? 0) + Number(r.outputTokens ?? 0),
        characters: Number(r.characters ?? 0),
        costPaise,
        costPerMinPaise: minutes > 0 ? Math.round(costPaise / minutes) : 0,
        avgLatencyMs: r.avgLatencyMs != null ? Math.round(Number(r.avgLatencyMs)) : null,
      };
    });

    const byService: Record<string, typeof providers> = {};
    for (const p of providers) {
      (byService[p.service] ??= []).push(p);
    }

    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      fxUsdToInr: fx,
      generatedAt: new Date().toISOString(),
      providers,
      byService,
      totalCostPaise: providers.reduce((s, p) => s + p.costPaise, 0),
    });
  } catch (err) {
    req.log?.error({ err }, "admin/analytics/providers failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

export default router;

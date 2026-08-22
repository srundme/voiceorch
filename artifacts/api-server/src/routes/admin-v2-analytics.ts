/**
 * Admin V2 analytics — canonical Daily P&L + Command Center overview.
 * Money in INR paise. Cost from usage_events USD micros → INR via FX setting.
 */
import { Router, type Request, type Response } from "express";
import {
  db,
  usersTable,
  walletTransactionsTable,
  usageEventsTable,
  callsTable,
  platformSettingsTable,
} from "@workspace/db";
import { eq, sql, and, gte, lte, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { CARD_PAID_DID_DEBIT_RAW, PHONE_FEE_DEBIT_RAW, REAL_CUSTOMER_TXN_RAW, SUCCESSFUL_TOPUP_RAW } from "../lib/recognized-revenue.js";

const router = Router();
router.use("/admin/analytics", requireAdmin);

const METRIC_DEFINITIONS = {
  cashCollectedPaise:
    "Completed topup/auto_topup credits for real users — same as Recharges (pre-GST).",
  recognizedRevenuePaise:
    "Abs(call_debit) plus abs(phone-number debit) wallet transactions — usage and DID fees recognized as revenue.",
  callRevenuePaise: "Abs(call_debit) wallet transactions in period.",
  phoneRevenuePaise:
    "Abs(debit) wallet rows whose description mentions phone (purchase, card, or monthly renewal).",
  variableCostPaise:
    "Sum of usage_events.estimated_cost_micros converted USD→INR paise via platform FX (approx COGS).",
  grossProfitPaise: "recognizedRevenuePaise - variableCostPaise",
  grossMarginPct: "grossProfitPaise / recognizedRevenuePaise × 100 (0 if no revenue)",
  billableMinutes: "Sum of call duration_seconds / 60 for calls in period",
  revenuePerMinPaise: "recognizedRevenuePaise / billableMinutes",
  costPerMinPaise: "variableCostPaise / billableMinutes",
  activeUsers: "Distinct users with at least one call in the period",
  payingUsers: "Distinct users with at least one call_debit in the period",
} as const;

function parseRange(req: Request): { from: Date; to: Date } {
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const from = req.query.from
    ? new Date(String(req.query.from))
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error("Invalid from/to date");
  }
  const toAdj = new Date(to);
  if (String(req.query.to ?? "").length <= 10) {
    toAdj.setHours(23, 59, 59, 999);
  }
  const fromAdj = new Date(from);
  if (String(req.query.from ?? "").length <= 10) {
    fromAdj.setHours(0, 0, 0, 0);
  }
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

function dayKey(d: Date | string): string {
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toISOString().slice(0, 10);
}

function eachDay(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cur = new Date(from);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cur <= end) {
    days.push(dayKey(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

type DayAgg = {
  date: string;
  users: number;
  calls: number;
  billableMinutes: number;
  cashCollectedPaise: number;
  callRevenuePaise: number;
  phoneRevenuePaise: number;
  recognizedRevenuePaise: number;
  variableCostPaise: number;
  grossProfitPaise: number;
  grossMarginPct: number;
  revenuePerMinPaise: number;
  costPerMinPaise: number;
};

function finalizeDay(partial: Omit<DayAgg, "grossProfitPaise" | "grossMarginPct" | "revenuePerMinPaise" | "costPerMinPaise">): DayAgg {
  const grossProfitPaise = partial.recognizedRevenuePaise - partial.variableCostPaise;
  const grossMarginPct =
    partial.recognizedRevenuePaise > 0
      ? (grossProfitPaise / partial.recognizedRevenuePaise) * 100
      : 0;
  const mins = partial.billableMinutes;
  return {
    ...partial,
    grossProfitPaise,
    grossMarginPct: Math.round(grossMarginPct * 100) / 100,
    revenuePerMinPaise: mins > 0 ? Math.round(partial.recognizedRevenuePaise / mins) : 0,
    costPerMinPaise: mins > 0 ? Math.round(partial.variableCostPaise / mins) : 0,
  };
}

async function computeDailySeries(from: Date, to: Date, fx: number): Promise<DayAgg[]> {
  const days = eachDay(from, to);
  const map = new Map<string, {
    users: Set<string>;
    calls: number;
    seconds: number;
    cash: number;
    callRev: number;
    phoneRev: number;
    costMicros: number;
  }>();
  for (const d of days) {
    map.set(d, { users: new Set(), calls: 0, seconds: 0, cash: 0, callRev: 0, phoneRev: 0, costMicros: 0 });
  }

  const callRows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${callsTable.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
      userId: callsTable.userId,
      seconds: sql<number>`coalesce(sum(${callsTable.durationSeconds}), 0)`,
      calls: sql<number>`count(*)`,
    })
    .from(callsTable)
    .where(and(gte(callsTable.createdAt, from), lte(callsTable.createdAt, to)))
    .groupBy(sql`1`, callsTable.userId);

  for (const row of callRows) {
    const bucket = map.get(row.day);
    if (!bucket) continue;
    bucket.calls += Number(row.calls ?? 0);
    bucket.seconds += Number(row.seconds ?? 0);
    if (row.userId) bucket.users.add(row.userId);
  }

  const cashRows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${walletTransactionsTable.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
      topupBase: sql<number>`coalesce(sum(${walletTransactionsTable.amountCents}) filter (
        where ${sql.raw(SUCCESSFUL_TOPUP_RAW)}
      ), 0)`,
    })
    .from(walletTransactionsTable)
    .where(
      and(
        gte(walletTransactionsTable.createdAt, from),
        lte(walletTransactionsTable.createdAt, to),
        sql`${sql.raw(SUCCESSFUL_TOPUP_RAW)}`,
        sql`${sql.raw(REAL_CUSTOMER_TXN_RAW)}`,
      ),
    )
    .groupBy(sql`1`);

  for (const row of cashRows) {
    const bucket = map.get(row.day);
    if (bucket) bucket.cash += Number(row.topupBase ?? 0);
  }

  const revRows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${walletTransactionsTable.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
      callPaise: sql<number>`coalesce(sum(abs(${walletTransactionsTable.amountCents})) filter (
        where ${walletTransactionsTable.type} = 'call_debit'
      ), 0)`,
      phonePaise: sql<number>`coalesce(sum(abs(${walletTransactionsTable.amountCents})) filter (
        where ${sql.raw(PHONE_FEE_DEBIT_RAW)}
      ), 0)`,
    })
    .from(walletTransactionsTable)
    .where(
      and(
        gte(walletTransactionsTable.createdAt, from),
        lte(walletTransactionsTable.createdAt, to),
        sql`(
          ${walletTransactionsTable.type} = 'call_debit'
          or (${sql.raw(PHONE_FEE_DEBIT_RAW)})
        )`,
      ),
    )
    .groupBy(sql`1`);

  for (const row of revRows) {
    const bucket = map.get(row.day);
    if (!bucket) continue;
    bucket.callRev += Number(row.callPaise ?? 0);
    bucket.phoneRev += Number(row.phonePaise ?? 0);
  }

  const costRows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${usageEventsTable.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
      micros: sql<number>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
    })
    .from(usageEventsTable)
    .where(and(gte(usageEventsTable.createdAt, from), lte(usageEventsTable.createdAt, to)))
    .groupBy(sql`1`);

  for (const row of costRows) {
    const bucket = map.get(row.day);
    if (bucket) bucket.costMicros += Number(row.micros ?? 0);
  }

  return days.map((date) => {
    const b = map.get(date)!;
    return finalizeDay({
      date,
      users: b.users.size,
      calls: b.calls,
      billableMinutes: Math.round((b.seconds / 60) * 100) / 100,
      cashCollectedPaise: b.cash,
      callRevenuePaise: b.callRev,
      phoneRevenuePaise: b.phoneRev,
      recognizedRevenuePaise: b.callRev + b.phoneRev,
      variableCostPaise: microsUsdToPaise(b.costMicros, fx),
    });
  });
}

function sumSeries(series: DayAgg[]) {
  const totals = series.reduce(
    (acc, d) => {
      acc.users = Math.max(acc.users, 0);
      acc.calls += d.calls;
      acc.billableMinutes += d.billableMinutes;
      acc.cashCollectedPaise += d.cashCollectedPaise;
      acc.callRevenuePaise += d.callRevenuePaise;
      acc.phoneRevenuePaise += d.phoneRevenuePaise;
      acc.recognizedRevenuePaise += d.recognizedRevenuePaise;
      acc.variableCostPaise += d.variableCostPaise;
      return acc;
    },
    {
      users: 0,
      calls: 0,
      billableMinutes: 0,
      cashCollectedPaise: 0,
      callRevenuePaise: 0,
      phoneRevenuePaise: 0,
      recognizedRevenuePaise: 0,
      variableCostPaise: 0,
    },
  );
  // Distinct users across period — recompute below if needed; for totals card use unique from series sum of daily is wrong.
  return finalizeDay({
    date: "total",
    users: 0,
    ...totals,
    billableMinutes: Math.round(totals.billableMinutes * 100) / 100,
  });
}

// ─── GET /admin/analytics/daily-pnl ───────────────────────────────────────────

router.get("/admin/analytics/daily-pnl", async (req, res): Promise<void> => {
  try {
    const { from, to } = parseRange(req);
    const fx = await usdToInrRate();
    const days = await computeDailySeries(from, to, fx);

    const distinctUsers = await db
      .select({ c: sql<number>`count(distinct ${callsTable.userId})` })
      .from(callsTable)
      .where(and(gte(callsTable.createdAt, from), lte(callsTable.createdAt, to)));

    const totals = sumSeries(days);
    totals.users = Number(distinctUsers[0]?.c ?? 0);

    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      fxUsdToInr: fx,
      generatedAt: new Date().toISOString(),
      meta: { definitions: METRIC_DEFINITIONS },
      totals,
      days,
    });
  } catch (err) {
    req.log?.error({ err }, "admin/analytics/daily-pnl failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ─── GET /admin/analytics/overview ────────────────────────────────────────────

router.get("/admin/analytics/overview", async (req, res): Promise<void> => {
  try {
    const { from, to } = parseRange(req);
    const fx = await usdToInrRate();
    const days = await computeDailySeries(from, to, fx);
    const totals = sumSeries(days);

    const [[userCounts], [active], [paying]] = await Promise.all([
      db
        .select({
          total: sql<number>`count(*)`,
          activeStatus: sql<number>`count(*) filter (where ${usersTable.status} = 'active')`,
        })
        .from(usersTable),
      db
        .select({ c: sql<number>`count(distinct ${callsTable.userId})` })
        .from(callsTable)
        .where(and(gte(callsTable.createdAt, from), lte(callsTable.createdAt, to))),
      db
        .select({
          c: sql<number>`count(distinct ${walletTransactionsTable.userId})`,
        })
        .from(walletTransactionsTable)
        .where(
          and(
            gte(walletTransactionsTable.createdAt, from),
            lte(walletTransactionsTable.createdAt, to),
            eq(walletTransactionsTable.type, "call_debit"),
          ),
        ),
    ]);

    // Compare period if provided
    let compare: { totals: DayAgg; from: string; to: string } | null = null;
    if (req.query.compareFrom && req.query.compareTo) {
      const cFrom = new Date(String(req.query.compareFrom));
      const cTo = new Date(String(req.query.compareTo));
      if (!Number.isNaN(cFrom.getTime()) && !Number.isNaN(cTo.getTime())) {
        if (String(req.query.compareTo).length <= 10) cTo.setHours(23, 59, 59, 999);
        const cDays = await computeDailySeries(cFrom, cTo, fx);
        compare = {
          totals: sumSeries(cDays),
          from: cFrom.toISOString(),
          to: cTo.toISOString(),
        };
      }
    }

    totals.users = Number(active[0]?.c ?? 0);

    const profitPerMinPaise =
      totals.billableMinutes > 0
        ? Math.round(totals.grossProfitPaise / totals.billableMinutes)
        : 0;
    const arpuPaise =
      Number(paying[0]?.c ?? 0) > 0
        ? Math.round(totals.recognizedRevenuePaise / Number(paying[0]?.c ?? 1))
        : 0;

    const [healthRow] = await db
      .select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where lower(coalesce(${callsTable.status}, '')) in ('completed','ended','done','success'))::int`,
        failed: sql<number>`count(*) filter (where lower(coalesce(${callsTable.status}, '')) in ('failed','error','busy','no-answer','canceled','cancelled'))::int`,
        avgDuration: sql<number>`coalesce(avg(${callsTable.durationSeconds}), 0)`,
        avgStt: sql<number>`coalesce(avg(${callsTable.sttLatencyMs}), 0)`,
        avgLlm: sql<number>`coalesce(avg(${callsTable.llmLatencyMs}), 0)`,
        avgTts: sql<number>`coalesce(avg(${callsTable.ttsFirstChunkMs}), 0)`,
      })
      .from(callsTable)
      .where(and(gte(callsTable.createdAt, from), lte(callsTable.createdAt, to)));

    const healthTotal = Number(healthRow?.total ?? 0);
    const healthCompleted = Number(healthRow?.completed ?? 0);
    const healthFailed = Number(healthRow?.failed ?? 0);

    const [revByUser, callByUser, costByUserRows, costByService] = await Promise.all([
      db
        .select({
          userId: walletTransactionsTable.userId,
          revenuePaise: sql<number>`coalesce(sum(abs(${walletTransactionsTable.amountCents})), 0)`,
        })
        .from(walletTransactionsTable)
        .where(
          and(
            gte(walletTransactionsTable.createdAt, from),
            lte(walletTransactionsTable.createdAt, to),
            eq(walletTransactionsTable.type, "call_debit"),
          ),
        )
        .groupBy(walletTransactionsTable.userId),
      db
        .select({
          userId: callsTable.userId,
          calls: sql<number>`count(*)`,
          seconds: sql<number>`coalesce(sum(${callsTable.durationSeconds}), 0)`,
        })
        .from(callsTable)
        .where(and(gte(callsTable.createdAt, from), lte(callsTable.createdAt, to)))
        .groupBy(callsTable.userId),
      db
        .select({
          userId: usageEventsTable.userId,
          micros: sql<number>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
        })
        .from(usageEventsTable)
        .where(and(gte(usageEventsTable.createdAt, from), lte(usageEventsTable.createdAt, to)))
        .groupBy(usageEventsTable.userId),
      db
        .select({
          service: usageEventsTable.service,
          micros: sql<number>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
        })
        .from(usageEventsTable)
        .where(and(gte(usageEventsTable.createdAt, from), lte(usageEventsTable.createdAt, to)))
        .groupBy(usageEventsTable.service),
    ]);

    const revMap = new Map(revByUser.filter((r) => r.userId).map((r) => [r.userId!, Number(r.revenuePaise ?? 0)]));
    const costMap = new Map(
      costByUserRows.filter((r) => r.userId).map((r) => [r.userId!, microsUsdToPaise(Number(r.micros ?? 0), fx)]),
    );
    const merged = callByUser
      .filter((r) => r.userId)
      .map((r) => {
        const userId = r.userId!;
        const revenuePaise = revMap.get(userId) ?? 0;
        const costPaise = costMap.get(userId) ?? 0;
        return {
          userId,
          calls: Number(r.calls ?? 0),
          minutes: Math.round((Number(r.seconds ?? 0) / 60) * 100) / 100,
          revenuePaise,
          costPaise,
          profitPaise: revenuePaise - costPaise,
        };
      })
      .sort((a, b) => b.revenuePaise - a.revenuePaise)
      .slice(0, 15);

    const emails = merged.length
      ? await db
          .select({ clerkId: usersTable.clerkId, email: usersTable.email, name: usersTable.name })
          .from(usersTable)
          .where(inArray(usersTable.clerkId, merged.map((m) => m.userId)))
      : [];
    const emailMap = new Map(emails.map((e) => [e.clerkId, e.email || e.name || e.clerkId]));

    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      fxUsdToInr: fx,
      generatedAt: new Date().toISOString(),
      meta: { definitions: METRIC_DEFINITIONS },
      kpis: {
        totalUsers: Number(userCounts?.total ?? 0),
        activeUsers: Number(active[0]?.c ?? 0),
        payingUsers: Number(paying[0]?.c ?? 0),
        calls: totals.calls,
        billableMinutes: totals.billableMinutes,
        cashCollectedPaise: totals.cashCollectedPaise,
        recognizedRevenuePaise: totals.recognizedRevenuePaise,
        variableCostPaise: totals.variableCostPaise,
        grossProfitPaise: totals.grossProfitPaise,
        grossMarginPct: totals.grossMarginPct,
        revenuePerMinPaise: totals.revenuePerMinPaise,
        costPerMinPaise: totals.costPerMinPaise,
        profitPerMinPaise,
        arpuPaise,
      },
      sparkline: days.map((d) => ({
        date: d.date,
        revenue: d.recognizedRevenuePaise,
        cost: d.variableCostPaise,
        profit: d.grossProfitPaise,
        calls: d.calls,
        billableMinutes: d.billableMinutes,
      })),
      health: {
        callSuccessRatePct: healthTotal > 0 ? Math.round((healthCompleted / healthTotal) * 1000) / 10 : 0,
        failureRatePct: healthTotal > 0 ? Math.round((healthFailed / healthTotal) * 1000) / 10 : 0,
        avgCallDurationSec: Math.round(Number(healthRow?.avgDuration ?? 0)),
        avgLatencyMs: Math.round(
          (Number(healthRow?.avgStt ?? 0) + Number(healthRow?.avgLlm ?? 0) + Number(healthRow?.avgTts ?? 0)) / 3,
        ),
        totalCalls: healthTotal,
      },
      topCustomers: merged.map((r) => ({
        ...r,
        label: emailMap.get(r.userId) ?? r.userId,
      })),
      costBreakdown: costByService.map((r) => ({
        service: r.service,
        costPaise: microsUsdToPaise(Number(r.micros ?? 0), fx),
      })),
      compare,
    });
  } catch (err) {
    req.log?.error({ err }, "admin/analytics/overview failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ─── GET /admin/analytics/unit-economics ──────────────────────────────────────

router.get("/admin/analytics/unit-economics", async (req, res): Promise<void> => {
  try {
    const { from, to } = parseRange(req);
    const fx = await usdToInrRate();
    const days = await computeDailySeries(from, to, fx);
    const totals = sumSeries(days);

    const [[active], [paying]] = await Promise.all([
      db
        .select({ c: sql<number>`count(distinct ${callsTable.userId})` })
        .from(callsTable)
        .where(and(gte(callsTable.createdAt, from), lte(callsTable.createdAt, to))),
      db
        .select({
          c: sql<number>`count(distinct ${walletTransactionsTable.userId})`,
        })
        .from(walletTransactionsTable)
        .where(
          and(
            gte(walletTransactionsTable.createdAt, from),
            lte(walletTransactionsTable.createdAt, to),
            eq(walletTransactionsTable.type, "call_debit"),
          ),
        ),
    ]);

    const activeUsers = Number(active?.[0]?.c ?? 0);
    const payingUsers = Number(paying?.[0]?.c ?? 0);
    const mins = totals.billableMinutes;
    const rev = totals.recognizedRevenuePaise;
    const cost = totals.variableCostPaise;
    const profit = rev - cost;

    const costByService = await db
      .select({
        service: usageEventsTable.service,
        micros: sql<number>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
      })
      .from(usageEventsTable)
      .where(and(gte(usageEventsTable.createdAt, from), lte(usageEventsTable.createdAt, to)))
      .groupBy(usageEventsTable.service);

    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      fxUsdToInr: fx,
      generatedAt: new Date().toISOString(),
      meta: {
        definitions: {
          ...METRIC_DEFINITIONS,
          arpuPaise: "Recognized revenue / paying users",
          revenuePerActiveUserPaise: "Recognized revenue / active users",
          costPerActiveUserPaise: "Variable cost / active users",
          profitPerMinPaise: "Revenue/min - Cost/min",
        },
      },
      kpis: {
        revenuePerMinPaise: mins > 0 ? Math.round(rev / mins) : 0,
        costPerMinPaise: mins > 0 ? Math.round(cost / mins) : 0,
        profitPerMinPaise: mins > 0 ? Math.round(profit / mins) : 0,
        grossMarginPct: rev > 0 ? Math.round((profit / rev) * 10000) / 100 : 0,
        revenuePerActiveUserPaise: activeUsers > 0 ? Math.round(rev / activeUsers) : 0,
        costPerActiveUserPaise: activeUsers > 0 ? Math.round(cost / activeUsers) : 0,
        arpuPaise: payingUsers > 0 ? Math.round(rev / payingUsers) : 0,
        billableMinutes: mins,
        activeUsers,
        payingUsers,
        recognizedRevenuePaise: rev,
        variableCostPaise: cost,
        grossProfitPaise: profit,
      },
      series: days.map((d) => ({
        date: d.date,
        revenuePerMinPaise: d.revenuePerMinPaise,
        costPerMinPaise: d.costPerMinPaise,
        profitPerMinPaise: d.revenuePerMinPaise - d.costPerMinPaise,
        grossMarginPct: d.grossMarginPct,
      })),
      costBreakdown: costByService.map((r) => ({
        service: r.service,
        costPaise: microsUsdToPaise(Number(r.micros ?? 0), fx),
      })),
    });
  } catch (err) {
    req.log?.error({ err }, "admin/analytics/unit-economics failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

export default router;

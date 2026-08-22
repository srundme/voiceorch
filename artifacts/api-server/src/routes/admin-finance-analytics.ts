/**
 * Admin finance analytics — audit ledger, unit economics, investor pack.
 * All monetary amounts are INR paise unless noted. Provider COGS is USD micros
 * (converted to approx INR paise via Vobiz FX setting / default 96).
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
import { eq, sql, and, gte, lte, desc, asc, inArray, count } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { GST_RATE } from "../lib/money-inr.js";
import {
  CARD_PAID_DID_DEBIT_RAW,
  CASH_IN_EVENT_RAW,
  LEDGER_ADJUSTMENT_RAW,
  PHONE_FEE_DEBIT_RAW,
  PROMO_ADMIN_CREDIT_RAW,
  RECOGNIZED_REVENUE_RAW,
  SUCCESSFUL_TOPUP_RAW,
  WALLET_FUNDED_PHONE_DEBIT_RAW,
  WALLET_INFLOW_RAW,
  cardPaidDidDebitRaw,
  recognizedRevenueRaw,
  successfulTopupRaw,
  topupGrossExpr,
  topupGrossPaise,
} from "../lib/recognized-revenue.js";
import { getVobizWalletStatus } from "../services/vobiz-wallet-monitor.js";

const router = Router();
router.use("/admin/finance", requireAdmin);

function parseRange(req: Request): { from: Date; to: Date } {
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const from = req.query.from
    ? new Date(String(req.query.from))
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error("Invalid from/to date");
  }
  // Inclusive end-of-day if date-only
  const toAdj = new Date(to);
  if (String(req.query.to ?? "").length <= 10) {
    toAdj.setHours(23, 59, 59, 999);
  }
  return { from, to: toAdj };
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
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

/** USD micros → INR paise */
function microsUsdToPaise(micros: number, rate: number): number {
  return Math.round((micros / 1_000_000) * rate * 100);
}

function isSuccessStatus(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "completed" || s === "success";
}

// ─── Audit summary / liability / GST strip ───────────────────────────────────

router.get("/admin/finance/audit-summary", async (req, res): Promise<void> => {
  try {
    const { from, to } = parseRange(req);
    const range = and(
      gte(walletTransactionsTable.createdAt, from),
      lte(walletTransactionsTable.createdAt, to),
    );

    const [
      [cashIn],
      [cardDidCash],
      [otherCredits],
      [recognized],
      [phoneDebits],
      [adjustments],
      [freeCredits],
      [pendingTopups],
      [failedTopups],
      [liability],
      [lifetimeCashIn],
      [lifetimeRecognized],
    ] = await Promise.all([
      db
        .select({
          paise: sql<number>`coalesce(sum(${walletTransactionsTable.amountCents}) filter (
            where ${walletTransactionsTable.type} in ('topup','auto_topup')
            and lower(${walletTransactionsTable.status}) in ('completed','success')
          ), 0)`,
          count: sql<number>`coalesce(count(*) filter (
            where ${walletTransactionsTable.type} in ('topup','auto_topup')
            and lower(${walletTransactionsTable.status}) in ('completed','success')
          ), 0)`,
        })
        .from(walletTransactionsTable)
        .where(range),
      db
        .select({
          paise: sql<number>`coalesce(sum(abs(${walletTransactionsTable.amountCents})), 0)`,
        })
        .from(walletTransactionsTable)
        .where(and(range, sql`${sql.raw(CARD_PAID_DID_DEBIT_RAW)}`)),
      db
        .select({
          paise: sql<number>`coalesce(sum(${walletTransactionsTable.amountCents}), 0)`,
        })
        .from(walletTransactionsTable)
        .where(and(range, sql`${sql.raw(PROMO_ADMIN_CREDIT_RAW)}`)),
      db
        .select({
          paise: sql<number>`coalesce(sum(abs(${walletTransactionsTable.amountCents})) filter (
            where ${walletTransactionsTable.type} = 'call_debit'
          ), 0)`,
        })
        .from(walletTransactionsTable)
        .where(range),
      db
        .select({
          paise: sql<number>`coalesce(sum(abs(${walletTransactionsTable.amountCents})) filter (
            where ${sql.raw(PHONE_FEE_DEBIT_RAW)}
          ), 0)`,
        })
        .from(walletTransactionsTable)
        .where(range),
      db
        .select({
          paise: sql<number>`coalesce(sum(${walletTransactionsTable.amountCents}) filter (
            where ${sql.raw(LEDGER_ADJUSTMENT_RAW)}
          ), 0)`,
        })
        .from(walletTransactionsTable)
        .where(range),
      db
        .select({
          paise: sql<number>`coalesce(sum(${walletTransactionsTable.amountCents}) filter (
            where ${walletTransactionsTable.type} = 'free_credit'
          ), 0)`,
        })
        .from(walletTransactionsTable)
        .where(range),
      db
        .select({ count: sql<number>`count(*)` })
        .from(walletTransactionsTable)
        .where(
          and(
            range,
            inArray(walletTransactionsTable.type, ["topup", "auto_topup"]),
            sql`lower(${walletTransactionsTable.status}) in ('pending','created','authorized')`,
          ),
        ),
      db
        .select({ count: sql<number>`count(*)` })
        .from(walletTransactionsTable)
        .where(
          and(
            range,
            inArray(walletTransactionsTable.type, ["topup", "auto_topup"]),
            sql`lower(${walletTransactionsTable.status}) in ('failed','cancelled')`,
          ),
        ),
      db
        .select({
          totalPaise: sql<number>`coalesce(sum(${usersTable.walletBalanceCents}), 0)`,
          users: count(),
        })
        .from(usersTable),
      db
        .select({
          paise: sql<number>`coalesce(sum(${walletTransactionsTable.amountCents}), 0)`,
        })
        .from(walletTransactionsTable)
        .where(
          and(
            inArray(walletTransactionsTable.type, ["topup", "auto_topup"]),
            sql`lower(${walletTransactionsTable.status}) in ('completed','success')`,
          ),
        ),
      db
        .select({
          paise: sql<number>`coalesce(sum(abs(${walletTransactionsTable.amountCents})), 0)`,
        })
        .from(walletTransactionsTable)
        .where(eq(walletTransactionsTable.type, "call_debit")),
    ]);

    const cashInPaise = Number(cashIn?.paise ?? 0);
    const otherCreditPaise = Number(otherCredits?.paise ?? 0);
    const walletCreditedPaise = cashInPaise + otherCreditPaise;
    const gstOnCashInPaise = Math.round(cashInPaise * GST_RATE);
    const topupGrossCollectedPaise = topupGrossPaise(cashInPaise, GST_RATE);
    const cardDidCashPaise = Number(cardDidCash?.paise ?? 0);
    const cashCollectedPaise = topupGrossCollectedPaise + cardDidCashPaise;
    const recognizedPaise = Number(recognized?.paise ?? 0);
    const phonePaise = Number(phoneDebits?.paise ?? 0);
    const recognizedRevenuePaise = recognizedPaise + phonePaise;
    const adjustmentsPaise = Number(adjustments?.paise ?? 0);
    const freeCreditPaise = Number(freeCredits?.paise ?? 0);
    const liabilityPaise = Number(liability?.totalPaise ?? 0);

    // Lifetime free credit / phones / adjustments for liability rollforward
    const [[lifetimeFree]] = await Promise.all([
      db
        .select({
          paise: sql<number>`coalesce(sum(${walletTransactionsTable.amountCents}), 0)`,
        })
        .from(walletTransactionsTable)
        .where(eq(walletTransactionsTable.type, "free_credit")),
    ]);
    const [[lifetimePhone]] = await Promise.all([
      db
        .select({
          paise: sql<number>`coalesce(sum(abs(${walletTransactionsTable.amountCents})), 0)`,
        })
        .from(walletTransactionsTable)
        .where(sql`${sql.raw(WALLET_FUNDED_PHONE_DEBIT_RAW)}`),
    ]);
    const [[lifetimeAdj]] = await Promise.all([
      db
        .select({
          paise: sql<number>`coalesce(sum(${walletTransactionsTable.amountCents}), 0)`,
        })
        .from(walletTransactionsTable)
        .where(sql`${sql.raw(LEDGER_ADJUSTMENT_RAW)}`),
    ]);

    const expectedLiabilityPaise =
      Number(lifetimeCashIn?.paise ?? 0) +
      Number(lifetimeFree?.paise ?? 0) -
      Number(lifetimeRecognized?.paise ?? 0) -
      Number(lifetimePhone?.paise ?? 0) +
      Number(lifetimeAdj?.paise ?? 0);
    const liabilityGapPaise = liabilityPaise - expectedLiabilityPaise;

    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      gstRate: GST_RATE,
      period: {
        cashInWalletCreditPaise: walletCreditedPaise,
        paidTopupWalletPaise: cashInPaise,
        otherCreditPaise,
        gstEstimatedPaise: gstOnCashInPaise,
        cashInTopupGrossPaise: topupGrossCollectedPaise,
        cashInCardDidPaise: cardDidCashPaise,
        cashCollectedEstPaise: cashCollectedPaise,
        cashCollectedPaise,
        topupCount: Number(cashIn?.count ?? 0),
        recognizedUsagePaise: recognizedPaise,
        recognizedRevenuePaise,
        phoneDebitPaise: phonePaise,
        adjustmentsPaise,
        freeCreditPaise,
        pendingTopups: Number(pendingTopups?.count ?? 0),
        failedTopups: Number(failedTopups?.count ?? 0),
      },
      liability: {
        userWalletSumPaise: liabilityPaise,
        userCount: Number(liability?.users ?? 0),
        expectedFromLedgerPaise: expectedLiabilityPaise,
        gapPaise: liabilityGapPaise,
        balanced: Math.abs(liabilityGapPaise) < 100, // within ₹1
      },
      definitions: {
        cashIn: "Rupees received: GST-inclusive topups + card-paid voice/WhatsApp numbers. Wallet-paid DIDs are not new cash.",
        cashInWalletCredit: "All completed wallet inflows: paid topups + signup/free + admin + partner transfers. GST is not applied here.",
        cashCollectedEst: "Same as cash-in (GST on topups + card-paid DID fees)",
        recognizedUsage: "Absolute call_debit amounts (calls only)",
        recognizedRevenue: "call_debit + phone / WhatsApp number fees",
        liability: "Sum of user wallet balances (prepaid deferred obligation). Phone outflows in the rollforward are wallet-funded only.",
      },
    });
  } catch (err) {
    req.log?.error?.({ err }, "admin/finance/audit-summary failed") ?? console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ─── Ledger (filterable) ─────────────────────────────────────────────────────

router.get("/admin/finance/ledger", async (req, res): Promise<void> => {
  try {
    const { from, to } = parseRange(req);
    const limit = Math.min(Number(req.query.limit ?? 100), 1000);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const type = req.query.type ? String(req.query.type) : null;
    const status = req.query.status ? String(req.query.status) : null;
    const tab = req.query.tab ? String(req.query.tab) : "all";

    const conditions = [
      gte(walletTransactionsTable.createdAt, from),
      lte(walletTransactionsTable.createdAt, to),
    ];

    if (type) conditions.push(eq(walletTransactionsTable.type, type));
    if (status) conditions.push(sql`lower(${walletTransactionsTable.status}) = ${status.toLowerCase()}`);

    if (tab === "cash_in") {
      conditions.push(sql`${sql.raw(CASH_IN_EVENT_RAW)}`);
    } else if (tab === "wallet_credit") {
      conditions.push(sql`${sql.raw(WALLET_INFLOW_RAW)}`);
    } else if (tab === "recognized") {
      conditions.push(sql`${sql.raw(RECOGNIZED_REVENUE_RAW)}`);
    } else if (tab === "phones") {
      conditions.push(sql`${sql.raw(PHONE_FEE_DEBIT_RAW)}`);
    } else if (tab === "adjustments") {
      conditions.push(sql`${sql.raw(LEDGER_ADJUSTMENT_RAW)}`);
    }

    const where = and(...conditions);

    const [rows, [total]] = await Promise.all([
      db
        .select({
          id: walletTransactionsTable.id,
          userId: walletTransactionsTable.userId,
          type: walletTransactionsTable.type,
          amountCents: walletTransactionsTable.amountCents,
          description: walletTransactionsTable.description,
          status: walletTransactionsTable.status,
          razorpayOrderId: walletTransactionsTable.razorpayOrderId,
          razorpayPaymentId: walletTransactionsTable.razorpayPaymentId,
          callId: walletTransactionsTable.callId,
          createdAt: walletTransactionsTable.createdAt,
          userEmail: usersTable.email,
          userName: usersTable.name,
          userClerkId: usersTable.clerkId,
        })
        .from(walletTransactionsTable)
        .leftJoin(usersTable, eq(walletTransactionsTable.userId, usersTable.id))
        .where(where)
        .orderBy(desc(walletTransactionsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(walletTransactionsTable).where(where),
    ]);

    res.json({
      rows,
      total: Number(total?.count ?? 0),
      limit,
      offset,
    });
  } catch (err) {
    req.log?.error?.({ err }, "admin/finance/ledger failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ─── Daily close ─────────────────────────────────────────────────────────────

router.get("/admin/finance/daily-close", async (req, res): Promise<void> => {
  try {
    const { from, to } = parseRange(req);
    const rows = await db.execute(sql`
      select
        date_trunc('day', created_at)::date as day,
        coalesce(sum(amount_cents) filter (
          where ${sql.raw(SUCCESSFUL_TOPUP_RAW)}
        ), 0)::bigint as topups_success_paise,
        coalesce(sum(abs(amount_cents)) filter (
          where ${sql.raw(CARD_PAID_DID_DEBIT_RAW)}
        ), 0)::bigint as card_did_cash_paise,
        coalesce(sum(abs(amount_cents)) filter (where type = 'call_debit'), 0)::bigint as call_debit_paise,
        coalesce(sum(abs(amount_cents)) filter (
          where ${sql.raw(PHONE_FEE_DEBIT_RAW)}
        ), 0)::bigint as phone_debit_paise,
        coalesce(sum(amount_cents) filter (
          where ${sql.raw(LEDGER_ADJUSTMENT_RAW)}
        ), 0)::bigint as adjustments_paise,
        count(*) filter (
          where ${sql.raw(SUCCESSFUL_TOPUP_RAW)}
        )::int as topup_count
      from wallet_transactions
      where created_at >= ${from} and created_at <= ${to}
      group by 1
      order by 1 asc
    `);

    const days = (rows.rows as Array<Record<string, unknown>>).map((r) => {
      const topups = Number(r.topups_success_paise ?? 0);
      const cardDid = Number(r.card_did_cash_paise ?? 0);
      const gstEstimatedPaise = Math.round(topups * GST_RATE);
      return {
        day: String(r.day).slice(0, 10),
        topupsSuccessPaise: topups,
        gstEstimatedPaise,
        cardDidCashPaise: cardDid,
        cashCollectedPaise: topups + gstEstimatedPaise + cardDid,
        callDebitPaise: Number(r.call_debit_paise ?? 0),
        phoneDebitPaise: Number(r.phone_debit_paise ?? 0),
        adjustmentsPaise: Number(r.adjustments_paise ?? 0),
        topupCount: Number(r.topup_count ?? 0),
      };
    });

    res.json({ from: from.toISOString(), to: to.toISOString(), days });
  } catch (err) {
    req.log?.error?.({ err }, "admin/finance/daily-close failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ─── Razorpay gaps ───────────────────────────────────────────────────────────

router.get("/admin/finance/razorpay-gaps", async (req, res): Promise<void> => {
  try {
    const hours = Math.min(Number(req.query.hours ?? 24), 720);
    const rows = await db
      .select({
        id: walletTransactionsTable.id,
        type: walletTransactionsTable.type,
        amountCents: walletTransactionsTable.amountCents,
        status: walletTransactionsTable.status,
        description: walletTransactionsTable.description,
        razorpayOrderId: walletTransactionsTable.razorpayOrderId,
        razorpayPaymentId: walletTransactionsTable.razorpayPaymentId,
        createdAt: walletTransactionsTable.createdAt,
        userEmail: usersTable.email,
        userClerkId: usersTable.clerkId,
      })
      .from(walletTransactionsTable)
      .leftJoin(usersTable, eq(walletTransactionsTable.userId, usersTable.id))
      .where(
        and(
          inArray(walletTransactionsTable.type, ["topup", "auto_topup"]),
          sql`lower(${walletTransactionsTable.status}) not in ('completed','success')`,
          sql`${walletTransactionsTable.createdAt} < now() - (${hours} || ' hours')::interval`,
        ),
      )
      .orderBy(desc(walletTransactionsTable.createdAt))
      .limit(200);

    res.json({ hours, rows });
  } catch (err) {
    req.log?.error?.({ err }, "admin/finance/razorpay-gaps failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Unit economics ──────────────────────────────────────────────────────────

router.get("/admin/finance/economics", async (req, res): Promise<void> => {
  try {
    const { from, to } = parseRange(req);
    const fx = await usdToInrRate();

    const ledgerDays = await db.execute(sql`
      select
        date_trunc('day', created_at)::date as day,
        coalesce(sum(abs(amount_cents)) filter (where type = 'call_debit'), 0)::bigint as recognized_paise,
        coalesce(sum(abs(amount_cents)) filter (
          where ${sql.raw(PHONE_FEE_DEBIT_RAW)}
        ), 0)::bigint as phone_paise,
        coalesce(sum(${sql.raw(topupGrossExpr())}) filter (
          where ${sql.raw(SUCCESSFUL_TOPUP_RAW)}
        ), 0)::bigint as topup_gross_paise,
        coalesce(sum(abs(amount_cents)) filter (
          where ${sql.raw(CARD_PAID_DID_DEBIT_RAW)}
        ), 0)::bigint as card_did_cash_paise
      from wallet_transactions
      where created_at >= ${from} and created_at <= ${to}
      group by 1
      order by 1
    `);

    const cogsDays = await db.execute(sql`
      select
        date_trunc('day', created_at)::date as day,
        coalesce(sum(estimated_cost_micros), 0)::bigint as cost_micros
      from usage_events
      where created_at >= ${from} and created_at <= ${to}
      group by 1
      order by 1
    `);

    const cogsMap = new Map<string, number>();
    for (const r of cogsDays.rows as Array<Record<string, unknown>>) {
      cogsMap.set(String(r.day).slice(0, 10), Number(r.cost_micros ?? 0));
    }

    const series = (ledgerDays.rows as Array<Record<string, unknown>>).map((r) => {
      const day = String(r.day).slice(0, 10);
      const recognized = Number(r.recognized_paise ?? 0);
      const phone = Number(r.phone_paise ?? 0);
      const cashIn = Number(r.topup_gross_paise ?? 0) + Number(r.card_did_cash_paise ?? 0);
      const cogsMicros = cogsMap.get(day) ?? 0;
      const cogsPaise = microsUsdToPaise(cogsMicros, fx);
      const revenue = recognized + phone;
      const marginPaise = revenue - cogsPaise;
      return {
        day,
        cashInPaise: cashIn,
        recognizedPaise: recognized,
        phonePaise: phone,
        revenuePaise: revenue,
        cogsUsdMicros: cogsMicros,
        cogsPaiseApprox: cogsPaise,
        marginPaiseApprox: marginPaise,
        marginPct: revenue > 0 ? Math.round((marginPaise / revenue) * 1000) / 10 : null,
      };
    });

    const totals = series.reduce(
      (a, d) => {
        a.cashIn += d.cashInPaise;
        a.revenue += d.revenuePaise;
        a.cogs += d.cogsPaiseApprox;
        return a;
      },
      { cashIn: 0, revenue: 0, cogs: 0 },
    );

    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      usdToInrRate: fx,
      totals: {
        cashInPaise: totals.cashIn,
        revenuePaise: totals.revenue,
        cogsPaiseApprox: totals.cogs,
        marginPaiseApprox: totals.revenue - totals.cogs,
        marginPct:
          totals.revenue > 0
            ? Math.round(((totals.revenue - totals.cogs) / totals.revenue) * 1000) / 10
            : null,
      },
      series,
      note: "COGS from usage_events is USD micros converted to INR at the platform FX rate — approximate.",
    });
  } catch (err) {
    req.log?.error?.({ err }, "admin/finance/economics failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ─── Monetization cohorts ────────────────────────────────────────────────────

router.get("/admin/finance/cohorts", async (_req, res): Promise<void> => {
  try {
    const rows = await db.execute(sql`
      with cohorts as (
        select id as user_id, date_trunc('week', created_at)::date as cohort_week
        from users
        where created_at > now() - interval '16 weeks'
      ),
      ever_paid as (
        select distinct user_id
        from wallet_transactions
        where type in ('topup','auto_topup') and lower(status) in ('completed','success')
      ),
      spend_d7 as (
        select c.user_id, coalesce(sum(abs(wt.amount_cents)), 0) as spend
        from cohorts c
        left join wallet_transactions wt
          on wt.user_id = c.user_id
          and wt.type = 'call_debit'
          and wt.created_at < c.cohort_week + interval '7 days'
        group by c.user_id
      ),
      spend_d30 as (
        select c.user_id, coalesce(sum(abs(wt.amount_cents)), 0) as spend
        from cohorts c
        left join wallet_transactions wt
          on wt.user_id = c.user_id
          and wt.type = 'call_debit'
          and wt.created_at < c.cohort_week + interval '30 days'
        group by c.user_id
      )
      select
        c.cohort_week::text as cohort_week,
        count(*)::int as signups,
        count(*) filter (where ep.user_id is not null)::int as ever_topped_up,
        coalesce(avg(s7.spend), 0)::bigint as avg_d7_spend_paise,
        coalesce(avg(s30.spend), 0)::bigint as avg_d30_spend_paise,
        coalesce(sum(s30.spend), 0)::bigint as total_d30_spend_paise
      from cohorts c
      left join ever_paid ep on ep.user_id = c.user_id
      left join spend_d7 s7 on s7.user_id = c.user_id
      left join spend_d30 s30 on s30.user_id = c.user_id
      group by 1
      order by 1 desc
    `);

    const cohorts = (rows.rows as Array<Record<string, unknown>>).map((r) => {
      const signups = Number(r.signups ?? 0);
      const paid = Number(r.ever_topped_up ?? 0);
      return {
        cohortWeek: String(r.cohort_week).slice(0, 10),
        signups,
        everToppedUp: paid,
        paidConversionPct: signups > 0 ? Math.round((paid / signups) * 1000) / 10 : 0,
        avgD7SpendPaise: Number(r.avg_d7_spend_paise ?? 0),
        avgD30SpendPaise: Number(r.avg_d30_spend_paise ?? 0),
        totalD30SpendPaise: Number(r.total_d30_spend_paise ?? 0),
      };
    });

    res.json({ cohorts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ─── Investor pack ───────────────────────────────────────────────────────────

router.get("/admin/finance/investor", async (req, res): Promise<void> => {
  try {
    const fx = await usdToInrRate();
    const months = Math.min(Number(req.query.months ?? 12), 24);

    const [
      [cashLifetime],
      [recognizedLifetime],
      [liability],
      [payers30],
      [payersPrev30],
      [cogs30],
      [minutes30],
      [refunds30],
      [failedPay30],
      t12,
      topPayers,
      vobiz,
    ] = await Promise.all([
      db
        .select({
          topupBase: sql<number>`coalesce(sum(amount_cents) filter (where ${sql.raw(SUCCESSFUL_TOPUP_RAW)}), 0)`,
          cardDid: sql<number>`coalesce(sum(abs(amount_cents)) filter (where ${sql.raw(CARD_PAID_DID_DEBIT_RAW)}), 0)`,
        })
        .from(walletTransactionsTable),
      db
        .select({
          paise: sql<number>`coalesce(sum(abs(amount_cents)), 0)`,
        })
        .from(walletTransactionsTable)
        .where(sql`${sql.raw(RECOGNIZED_REVENUE_RAW)}`),
      db
        .select({
          paise: sql<number>`coalesce(sum(${usersTable.walletBalanceCents}), 0)`,
        })
        .from(usersTable),
      db
        .select({
          count: sql<number>`count(distinct user_id)`,
        })
        .from(walletTransactionsTable)
        .where(
          sql`(${sql.raw(CASH_IN_EVENT_RAW)})
            and created_at > now() - interval '30 days'`,
        ),
      db
        .select({
          count: sql<number>`count(distinct user_id)`,
        })
        .from(walletTransactionsTable)
        .where(
          sql`(${sql.raw(CASH_IN_EVENT_RAW)})
            and created_at > now() - interval '60 days'
            and created_at <= now() - interval '30 days'`,
        ),
      db
        .select({
          micros: sql<number>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
        })
        .from(usageEventsTable)
        .where(sql`${usageEventsTable.createdAt} > now() - interval '30 days'`),
      db
        .select({
          seconds: sql<number>`coalesce(sum(${callsTable.durationSeconds}), 0)`,
        })
        .from(callsTable)
        .where(sql`${callsTable.createdAt} > now() - interval '30 days'`),
      db
        .select({
          paise: sql<number>`coalesce(sum(abs(amount_cents)), 0)`,
          count: sql<number>`count(*)`,
        })
        .from(walletTransactionsTable)
        .where(
          sql`type = 'refund' and created_at > now() - interval '30 days'`,
        ),
      db
        .select({ count: sql<number>`count(*)` })
        .from(walletTransactionsTable)
        .where(
          sql`type in ('topup','auto_topup') and lower(status) in ('failed','cancelled')
            and created_at > now() - interval '30 days'`,
        ),
      db.execute(sql`
        select
          date_trunc('month', created_at)::date as month,
          coalesce(sum(${sql.raw(topupGrossExpr())}) filter (
            where ${sql.raw(SUCCESSFUL_TOPUP_RAW)}
          ), 0)::bigint
          + coalesce(sum(abs(amount_cents)) filter (
            where ${sql.raw(CARD_PAID_DID_DEBIT_RAW)}
          ), 0)::bigint as cash_in_paise,
          coalesce(sum(abs(amount_cents)) filter (where ${sql.raw(RECOGNIZED_REVENUE_RAW)}), 0)::bigint as recognized_paise,
          count(distinct user_id) filter (
            where ${sql.raw(CASH_IN_EVENT_RAW)}
          )::int as paying_users
        from wallet_transactions
        where created_at > now() - (${months} || ' months')::interval
        group by 1
        order by 1 asc
      `),
      db.execute(sql`
        select
          u.clerk_id,
          u.email,
          u.name,
          coalesce(sum(abs(wt.amount_cents)) filter (where ${sql.raw(recognizedRevenueRaw("wt"))}), 0)::bigint as spend_paise,
          coalesce(sum(${sql.raw(topupGrossExpr("wt"))}) filter (
            where ${sql.raw(successfulTopupRaw("wt"))}
          ), 0)::bigint
          + coalesce(sum(abs(wt.amount_cents)) filter (
            where ${sql.raw(cardPaidDidDebitRaw("wt"))}
          ), 0)::bigint as topup_paise
        from wallet_transactions wt
        join users u on u.id = wt.user_id
        where wt.created_at > now() - interval '90 days'
        group by u.clerk_id, u.email, u.name
        order by spend_paise desc
        limit 10
      `),
      getVobizWalletStatus().catch(() => null),
    ]);

    const cashIn =
      topupGrossPaise(Number(cashLifetime?.topupBase ?? 0), GST_RATE) +
      Number(cashLifetime?.cardDid ?? 0);
    const recognized = Number(recognizedLifetime?.paise ?? 0);
    const cogs30Paise = microsUsdToPaise(Number(cogs30?.micros ?? 0), fx);
    const revenue30 = await db
      .select({
        paise: sql<number>`coalesce(sum(abs(amount_cents)), 0)`,
      })
      .from(walletTransactionsTable)
      .where(
        sql`${sql.raw(RECOGNIZED_REVENUE_RAW)} and created_at > now() - interval '30 days'`,
      );
    const rev30 = Number(revenue30[0]?.paise ?? 0);

    const trailing = (t12.rows as Array<Record<string, unknown>>).map((r) => ({
      month: String(r.month).slice(0, 7),
      cashInPaise: Number(r.cash_in_paise ?? 0),
      recognizedPaise: Number(r.recognized_paise ?? 0),
      payingUsers: Number(r.paying_users ?? 0),
    }));

    const top = (topPayers.rows as Array<Record<string, unknown>>).map((r) => ({
      clerkId: String(r.clerk_id),
      email: r.email ? String(r.email) : null,
      name: r.name ? String(r.name) : null,
      spend90dPaise: Number(r.spend_paise ?? 0),
      topup90dPaise: Number(r.topup_paise ?? 0),
    }));
    const topSpendSum = top.reduce((a, t) => a + t.spend90dPaise, 0);
    const totalSpend90 = await db
      .select({
        paise: sql<number>`coalesce(sum(abs(amount_cents)), 0)`,
      })
      .from(walletTransactionsTable)
      .where(sql`${sql.raw(RECOGNIZED_REVENUE_RAW)} and created_at > now() - interval '90 days'`);
    const spend90All = Number(totalSpend90[0]?.paise ?? 0);

    res.json({
      headline: {
        cashCollectedLifetimePaise: cashIn,
        cashCollectedLifetimeEstWithGstPaise: cashIn,
        cashInWalletCreditPaise: Number(cashLifetime?.topupBase ?? 0),
        cashInCardDidPaise: Number(cashLifetime?.cardDid ?? 0),
        walletLiabilityPaise: Number(liability?.paise ?? 0),
        recognizedUsageLifetimePaise: recognized,
        last30d: {
          activePayers: Number(payers30?.count ?? 0),
          prevActivePayers: Number(payersPrev30?.count ?? 0),
          recognizedPaise: rev30,
          cogsPaiseApprox: cogs30Paise,
          marginPaiseApprox: rev30 - cogs30Paise,
          marginPct: rev30 > 0 ? Math.round(((rev30 - cogs30Paise) / rev30) * 1000) / 10 : null,
          minutes: Math.round(Number(minutes30?.seconds ?? 0) / 60),
          refundPaise: Number(refunds30?.paise ?? 0),
          refundCount: Number(refunds30?.count ?? 0),
          failedPayments: Number(failedPay30?.count ?? 0),
        },
      },
      trailingMonths: trailing,
      concentration: {
        top10Spend90dPaise: topSpendSum,
        allSpend90dPaise: spend90All,
        top10SharePct:
          spend90All > 0 ? Math.round((topSpendSum / spend90All) * 1000) / 10 : 0,
        topPayers: top,
      },
      vobiz: vobiz
        ? {
            balanceInr: vobiz.vobizBalanceInr,
            status: vobiz.status,
            recommendedInr: vobiz.requiredMinInr,
            shortfallInr: vobiz.shortfallInr,
            thresholdPct: vobiz.thresholdPct,
          }
        : null,
      usdToInrRate: fx,
      definitions: {
        cashCollected: "Rupees received: GST-inclusive topups + card-paid voice/WhatsApp numbers.",
        liability: "Sum of prepaid wallet balances still owed as service.",
        recognized: "call_debit plus phone / WhatsApp number fees.",
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ─── CSV exports ─────────────────────────────────────────────────────────────

router.get("/admin/finance/export.csv", async (req, res): Promise<void> => {
  try {
    const kind = String(req.query.kind ?? "ledger");
    const { from, to } = parseRange(req);

    if (kind === "daily-close") {
      const data = await db.execute(sql`
        select
          date_trunc('day', created_at)::date as day,
          coalesce(sum(amount_cents) filter (
            where ${sql.raw(SUCCESSFUL_TOPUP_RAW)}
          ), 0)::bigint as topups_success_paise,
          coalesce(sum(abs(amount_cents)) filter (
            where ${sql.raw(CARD_PAID_DID_DEBIT_RAW)}
          ), 0)::bigint as card_did_cash_paise,
          coalesce(sum(abs(amount_cents)) filter (where type = 'call_debit'), 0)::bigint as call_debit_paise,
          coalesce(sum(abs(amount_cents)) filter (
            where ${sql.raw(PHONE_FEE_DEBIT_RAW)}
          ), 0)::bigint as phone_debit_paise,
          coalesce(sum(amount_cents) filter (
            where ${sql.raw(LEDGER_ADJUSTMENT_RAW)}
          ), 0)::bigint as adjustments_paise
        from wallet_transactions
        where created_at >= ${from} and created_at <= ${to}
        group by 1 order by 1
      `);
      const header =
        "day,topups_success_paise,gst_estimated_paise,card_did_cash_paise,cash_collected_paise,call_debit_paise,phone_debit_paise,adjustments_paise\n";
      const lines = (data.rows as Array<Record<string, unknown>>)
        .map((r) => {
          const top = Number(r.topups_success_paise ?? 0);
          const gst = Math.round(top * GST_RATE);
          const cardDid = Number(r.card_did_cash_paise ?? 0);
          return [
            String(r.day).slice(0, 10),
            top,
            gst,
            cardDid,
            top + gst + cardDid,
            Number(r.call_debit_paise ?? 0),
            Number(r.phone_debit_paise ?? 0),
            Number(r.adjustments_paise ?? 0),
          ].join(",");
        })
        .join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="snapserve-daily-close-${from.toISOString().slice(0, 10)}.csv"`,
      );
      res.send(header + lines + "\n");
      return;
    }

    // Default: full ledger
    const clerkId = req.query.clerkId ? String(req.query.clerkId) : null;
    const conditions = [
      gte(walletTransactionsTable.createdAt, from),
      lte(walletTransactionsTable.createdAt, to),
    ];
    if (clerkId) {
      conditions.push(eq(usersTable.clerkId, clerkId));
    }

    const rows = await db
      .select({
        id: walletTransactionsTable.id,
        createdAt: walletTransactionsTable.createdAt,
        type: walletTransactionsTable.type,
        status: walletTransactionsTable.status,
        amountCents: walletTransactionsTable.amountCents,
        description: walletTransactionsTable.description,
        razorpayOrderId: walletTransactionsTable.razorpayOrderId,
        razorpayPaymentId: walletTransactionsTable.razorpayPaymentId,
        callId: walletTransactionsTable.callId,
        userEmail: usersTable.email,
        userClerkId: usersTable.clerkId,
        userName: usersTable.name,
      })
      .from(walletTransactionsTable)
      .leftJoin(usersTable, eq(walletTransactionsTable.userId, usersTable.id))
      .where(and(...conditions))
      .orderBy(asc(walletTransactionsTable.createdAt))
      .limit(50_000);

    const header =
      "id,created_at,clerk_id,email,name,type,status,amount_paise,amount_inr,description,razorpay_order_id,razorpay_payment_id,call_id,gst_est_paise\n";
    const lines = rows
      .map((r) => {
        const amount = r.amountCents;
        const gst =
          (r.type === "topup" || r.type === "auto_topup") && isSuccessStatus(r.status)
            ? Math.round(Math.max(0, amount) * GST_RATE)
            : "";
        return [
          r.id,
          r.createdAt.toISOString(),
          csvEscape(r.userClerkId),
          csvEscape(r.userEmail),
          csvEscape(r.userName),
          csvEscape(r.type),
          csvEscape(r.status),
          amount,
          (amount / 100).toFixed(2),
          csvEscape(r.description),
          csvEscape(r.razorpayOrderId),
          csvEscape(r.razorpayPaymentId),
          r.callId ?? "",
          gst,
        ].join(",");
      })
      .join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="snapserve-ledger-${from.toISOString().slice(0, 10)}.csv"`,
    );
    res.send(header + lines + "\n");
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

export default router;

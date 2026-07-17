/**
 * Admin "Board" analytics — founder / investor deck.
 *
 * Five dashboards layered on the existing finance/growth data:
 *   1. Company Pulse (daily open)
 *   2. Growth
 *   3. Retention & Health
 *   4. Product Moat
 *   5. Unit Economics Deep-Dive
 *
 * All monetary amounts are INR paise. Provider COGS lives in usage_events as
 * USD micros and is converted to approx INR paise via the platform FX setting.
 * "Tenant" == user account (no subscription/tenant model). Real users only
 * (is_test = false) unless noted. A few figures have no source data and come
 * from admin-entered board settings (cash-on-hand, monthly burn, CAC, telephony
 * cost/min, flagship client).
 */
import { Router, type Request, type Response } from "express";
import { db, platformSettingsTable } from "@workspace/db";
import { eq, sql, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";

const router = Router();
router.use("/admin/board", requireAdmin);

// ─── Board settings (manual inputs, no source data) ──────────────────────────

const KEYS = {
  cashOnHand: "board_cash_on_hand_paise",
  monthlyBurn: "board_monthly_burn_paise",
  cac: "board_cac_paise",
  telephonyPerMin: "board_telephony_cost_paise_per_min",
  flagshipClerkId: "board_flagship_clerk_id",
  flagshipGoal: "board_flagship_goal",
} as const;

interface BoardSettings {
  cashOnHandPaise: number;
  monthlyBurnPaise: number;
  cacPaise: number;
  telephonyCostPaisePerMin: number;
  flagshipClerkId: string | null;
  flagshipGoal: number;
}

async function readBoardSettings(): Promise<BoardSettings> {
  const rows = await db
    .select()
    .from(platformSettingsTable)
    .where(inArray(platformSettingsTable.key, Object.values(KEYS)));
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const num = (k: string, d: number): number => {
    const n = Number(map.get(k));
    return Number.isFinite(n) ? n : d;
  };
  return {
    cashOnHandPaise: num(KEYS.cashOnHand, 0),
    monthlyBurnPaise: num(KEYS.monthlyBurn, 0),
    cacPaise: num(KEYS.cac, 0),
    telephonyCostPaisePerMin: num(KEYS.telephonyPerMin, 0),
    flagshipClerkId: map.get(KEYS.flagshipClerkId) ?? null,
    flagshipGoal: num(KEYS.flagshipGoal, 100_000),
  };
}

async function upsertSetting(key: string, value: string): Promise<void> {
  await db
    .insert(platformSettingsTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: platformSettingsTable.key, set: { value, updatedAt: new Date() } });
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

const N = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

router.get("/admin/board/settings", async (_req, res): Promise<void> => {
  try {
    res.json(await readBoardSettings());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.put("/admin/board/settings", async (req, res): Promise<void> => {
  try {
    const b = req.body as Partial<BoardSettings>;
    const numeric: Array<[keyof BoardSettings, string]> = [
      ["cashOnHandPaise", KEYS.cashOnHand],
      ["monthlyBurnPaise", KEYS.monthlyBurn],
      ["cacPaise", KEYS.cac],
      ["telephonyCostPaisePerMin", KEYS.telephonyPerMin],
      ["flagshipGoal", KEYS.flagshipGoal],
    ];
    for (const [field, key] of numeric) {
      const v = b[field];
      if (v === undefined) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        res.status(400).json({ error: `${field} must be a non-negative number` });
        return;
      }
      await upsertSetting(key, String(Math.round(n)));
    }
    if (b.flagshipClerkId !== undefined) {
      const v = b.flagshipClerkId;
      if (v === null || v === "") {
        await db.delete(platformSettingsTable).where(eq(platformSettingsTable.key, KEYS.flagshipClerkId));
      } else if (typeof v === "string") {
        await upsertSetting(KEYS.flagshipClerkId, v);
      }
    }
    res.json(await readBoardSettings());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// Reusable SQL fragment: calls belonging to real (non-test) users.
const realCallUsers = sql`user_id in (select clerk_id from users where is_test = false)`;

// ─── 1. Company Pulse ────────────────────────────────────────────────────────

router.get("/admin/board/pulse", async (_req, res): Promise<void> => {
  try {
    const fx = await usdToInrRate();
    const settings = await readBoardSettings();

    const [minutesRows, revRows, cogsRows, tenantRows] = await Promise.all([
      db.execute(sql`
        select
          coalesce(sum(duration_seconds) filter (where created_at >= date_trunc('day', now())), 0)::bigint as sec_today,
          coalesce(sum(duration_seconds) filter (where created_at >= date_trunc('month', now())), 0)::bigint as sec_month,
          coalesce(sum(duration_seconds) filter (where created_at > now() - interval '30 days'), 0)::bigint as sec_30d
        from calls
        where ${realCallUsers}
      `),
      db.execute(sql`
        select
          coalesce(sum(abs(wt.amount_cents)) filter (where wt.created_at > now() - interval '30 days'), 0)::bigint as rev_30,
          coalesce(sum(abs(wt.amount_cents)) filter (
            where wt.created_at > now() - interval '60 days' and wt.created_at <= now() - interval '30 days'
          ), 0)::bigint as rev_prev_30
        from wallet_transactions wt
        join users u on u.id = wt.user_id
        where wt.type = 'call_debit' and u.is_test = false
      `),
      db.execute(sql`
        select coalesce(sum(ue.estimated_cost_micros), 0)::bigint as cost_micros
        from usage_events ue
        join calls c on c.id = ue.call_id
        where ue.created_at > now() - interval '30 days'
          and c.user_id in (select clerk_id from users where is_test = false)
      `),
      db.execute(sql`
        select
          count(*)::int as total_real,
          count(*) filter (where exists (
            select 1 from wallet_transactions wt
            where wt.user_id = u.id and wt.type in ('topup','auto_topup')
              and lower(wt.status) in ('completed','success')
          ))::int as paying
        from users u
        where u.is_test = false
      `),
    ]);

    const secToday = N(minutesRows.rows[0]?.sec_today);
    const secMonth = N(minutesRows.rows[0]?.sec_month);
    const sec30d = N(minutesRows.rows[0]?.sec_30d);
    const minutes30 = sec30d / 60;

    const rev30 = N(revRows.rows[0]?.rev_30);
    const revPrev30 = N(revRows.rows[0]?.rev_prev_30);
    const cogs30Paise = microsUsdToPaise(N(cogsRows.rows[0]?.cost_micros), fx);
    const telephony30Paise = Math.round(settings.telephonyCostPaisePerMin * minutes30);

    const totalReal = N(tenantRows.rows[0]?.total_real);
    const paying = N(tenantRows.rows[0]?.paying);

    const revenuePerMinPaise = minutes30 > 0 ? rev30 / minutes30 : 0;
    const costPerMinPaise = minutes30 > 0 ? (cogs30Paise + telephony30Paise) / minutes30 : 0;
    const totalCost30 = cogs30Paise + telephony30Paise;

    res.json({
      minutes: { today: Math.round(secToday / 60), month: Math.round(secMonth / 60) },
      mrr: {
        currentPaise: rev30,
        prevPaise: revPrev30,
        growthPct: revPrev30 > 0 ? Math.round(((rev30 - revPrev30) / revPrev30) * 1000) / 10 : null,
      },
      margin: {
        minutes30: Math.round(minutes30),
        revenue30Paise: rev30,
        cogs30Paise,
        telephony30Paise,
        revenuePerMinPaise: Math.round(revenuePerMinPaise),
        costPerMinPaise: Math.round(costPerMinPaise),
        grossMarginPerMinPaise: Math.round(revenuePerMinPaise - costPerMinPaise),
        marginPct: rev30 > 0 ? Math.round(((rev30 - totalCost30) / rev30) * 1000) / 10 : null,
      },
      tenants: { paying, poc: Math.max(0, totalReal - paying), totalReal },
      runway: {
        cashOnHandPaise: settings.cashOnHandPaise,
        monthlyBurnPaise: settings.monthlyBurnPaise,
        months:
          settings.monthlyBurnPaise > 0
            ? Math.round((settings.cashOnHandPaise / settings.monthlyBurnPaise) * 10) / 10
            : null,
      },
      usdToInrRate: fx,
      telephonyCostPaisePerMin: settings.telephonyCostPaisePerMin,
      note: "COGS is provider usage (STT/LLM/TTS) converted USD→INR; telephony cost/min is admin-entered. Margin is approximate.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ─── 2. Growth ───────────────────────────────────────────────────────────────

router.get("/admin/board/growth", async (_req, res): Promise<void> => {
  try {
    const settings = await readBoardSettings();

    const [mins, signups, tenantRows, conc, allSpend] = await Promise.all([
      db.execute(sql`
        select date_trunc('month', created_at)::date as month, coalesce(sum(duration_seconds), 0)::bigint as sec
        from calls
        where created_at > now() - interval '12 months' and ${realCallUsers}
        group by 1 order by 1
      `),
      db.execute(sql`
        select date_trunc('month', created_at)::date as month, count(*)::int as n
        from users
        where is_test = false and created_at > now() - interval '12 months'
        group by 1 order by 1
      `),
      db.execute(sql`
        select
          count(*)::int as total_real,
          count(*) filter (where exists (
            select 1 from wallet_transactions wt
            where wt.user_id = u.id and wt.type in ('topup','auto_topup')
              and lower(wt.status) in ('completed','success')
          ))::int as paying
        from users u where u.is_test = false
      `),
      db.execute(sql`
        select u.clerk_id, u.email, u.name, coalesce(sum(abs(wt.amount_cents)), 0)::bigint as spend
        from wallet_transactions wt join users u on u.id = wt.user_id
        where wt.type = 'call_debit' and u.is_test = false and wt.created_at > now() - interval '90 days'
        group by u.clerk_id, u.email, u.name
        order by spend desc limit 10
      `),
      db.execute(sql`
        select coalesce(sum(abs(wt.amount_cents)), 0)::bigint as spend
        from wallet_transactions wt join users u on u.id = wt.user_id
        where wt.type = 'call_debit' and u.is_test = false and wt.created_at > now() - interval '90 days'
      `),
    ]);

    const byMonthMap = new Map<string, { month: string; minutes: number; newTenants: number }>();
    for (const r of mins.rows as Array<Record<string, unknown>>) {
      const m = String(r.month).slice(0, 7);
      byMonthMap.set(m, { month: m, minutes: Math.round(N(r.sec) / 60), newTenants: 0 });
    }
    for (const r of signups.rows as Array<Record<string, unknown>>) {
      const m = String(r.month).slice(0, 7);
      const cur = byMonthMap.get(m) ?? { month: m, minutes: 0, newTenants: 0 };
      cur.newTenants = N(r.n);
      byMonthMap.set(m, cur);
    }
    const byMonth = [...byMonthMap.values()].sort((a, b) => a.month.localeCompare(b.month));

    const totalReal = N(tenantRows.rows[0]?.total_real);
    const paying = N(tenantRows.rows[0]?.paying);

    const topPayers = (conc.rows as Array<Record<string, unknown>>).map((r) => ({
      clerkId: String(r.clerk_id),
      email: r.email ? String(r.email) : null,
      name: r.name ? String(r.name) : null,
      spendPaise: N(r.spend),
    }));
    const allSpend90 = N(allSpend.rows[0]?.spend);
    const topClient = topPayers[0] ?? null;

    // Flagship trajectory
    let flagship: unknown = null;
    if (settings.flagshipClerkId) {
      const [uRow, fm] = await Promise.all([
        db.execute(sql`select clerk_id, name, email from users where clerk_id = ${settings.flagshipClerkId} limit 1`),
        db.execute(sql`
          select date_trunc('month', created_at)::date as month, count(*)::int as calls
          from calls
          where user_id = ${settings.flagshipClerkId} and created_at > now() - interval '12 months'
          group by 1 order by 1
        `),
      ]);
      const u = uRow.rows[0] as Record<string, unknown> | undefined;
      const months = (fm.rows as Array<Record<string, unknown>>).map((r) => ({
        month: String(r.month).slice(0, 7),
        calls: N(r.calls),
      }));
      const currentMonth = new Date().toISOString().slice(0, 7);
      flagship = {
        clerkId: settings.flagshipClerkId,
        name: (u?.name as string) || (u?.email as string) || settings.flagshipClerkId,
        goal: settings.flagshipGoal,
        byMonth: months,
        currentMonthCalls: months.find((m) => m.month === currentMonth)?.calls ?? 0,
      };
    }

    res.json({
      byMonth,
      conversion: {
        totalTenants: totalReal,
        payingTenants: paying,
        pocTenants: Math.max(0, totalReal - paying),
        pocToPaidPct: totalReal > 0 ? Math.round((paying / totalReal) * 1000) / 10 : 0,
      },
      flagship,
      concentration: {
        allSpend90dPaise: allSpend90,
        topClient: topClient
          ? {
              ...topClient,
              sharePct: allSpend90 > 0 ? Math.round((topClient.spendPaise / allSpend90) * 1000) / 10 : 0,
            }
          : null,
        topPayers,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ─── 3. Retention & Health ───────────────────────────────────────────────────

router.get("/admin/board/retention", async (_req, res): Promise<void> => {
  try {
    const [wow, churn, nrr] = await Promise.all([
      db.execute(sql`
        select c.user_id as clerk_id, u.name, u.email,
          coalesce(sum(c.duration_seconds) filter (where c.created_at > now() - interval '7 days'), 0)::bigint as sec_this,
          coalesce(sum(c.duration_seconds) filter (
            where c.created_at > now() - interval '14 days' and c.created_at <= now() - interval '7 days'
          ), 0)::bigint as sec_prev
        from calls c join users u on u.clerk_id = c.user_id
        where u.is_test = false and c.created_at > now() - interval '14 days'
        group by c.user_id, u.name, u.email
      `),
      db.execute(sql`
        with active as (
          select wt.user_id,
            bool_or(wt.created_at >= date_trunc('month', now())) as curr,
            bool_or(wt.created_at >= date_trunc('month', now()) - interval '1 month'
                    and wt.created_at < date_trunc('month', now())) as prev,
            coalesce(sum(abs(wt.amount_cents)) filter (
              where wt.created_at >= date_trunc('month', now()) - interval '1 month'
                and wt.created_at < date_trunc('month', now())
            ), 0) as prev_rev
          from wallet_transactions wt join users u on u.id = wt.user_id
          where wt.type = 'call_debit' and u.is_test = false
            and wt.created_at >= date_trunc('month', now()) - interval '1 month'
          group by wt.user_id
        )
        select
          count(*) filter (where prev)::int as active_prev,
          count(*) filter (where curr)::int as active_curr,
          count(*) filter (where prev and not curr)::int as churned_logos,
          coalesce(sum(prev_rev) filter (where prev and not curr), 0)::bigint as churned_rev_paise
        from active
      `),
      db.execute(sql`
        with per as (
          select wt.user_id,
            coalesce(sum(abs(wt.amount_cents)) filter (
              where wt.created_at >= date_trunc('month', now()) - interval '1 month'
                and wt.created_at < date_trunc('month', now())
            ), 0) as prev_rev,
            coalesce(sum(abs(wt.amount_cents)) filter (where wt.created_at >= date_trunc('month', now())), 0) as curr_rev
          from wallet_transactions wt join users u on u.id = wt.user_id
          where wt.type = 'call_debit' and u.is_test = false
            and wt.created_at >= date_trunc('month', now()) - interval '1 month'
          group by wt.user_id
        )
        select
          coalesce(sum(prev_rev), 0)::bigint as start_rev,
          coalesce(sum(curr_rev) filter (where prev_rev > 0), 0)::bigint as retained_curr_rev
        from per
      `),
    ]);

    const tenants = (wow.rows as Array<Record<string, unknown>>)
      .map((r) => {
        const minutesThis = N(r.sec_this) / 60;
        const minutesPrev = N(r.sec_prev) / 60;
        const wowPct =
          minutesPrev > 0
            ? Math.round(((minutesThis - minutesPrev) / minutesPrev) * 1000) / 10
            : minutesThis > 0
              ? 100
              : 0;
        return {
          clerkId: String(r.clerk_id),
          name: r.name ? String(r.name) : null,
          email: r.email ? String(r.email) : null,
          minutesThisWeek: Math.round(minutesThis * 10) / 10,
          minutesPrevWeek: Math.round(minutesPrev * 10) / 10,
          wowPct,
          atRisk: minutesPrev > 0 && (minutesThis - minutesPrev) / minutesPrev <= -0.3,
        };
      })
      .filter((t) => t.minutesThisWeek > 0 || t.minutesPrevWeek > 0)
      .sort((a, b) => a.wowPct - b.wowPct);

    const activePrev = N(churn.rows[0]?.active_prev);
    const activeCurr = N(churn.rows[0]?.active_curr);
    const churnedLogos = N(churn.rows[0]?.churned_logos);
    const churnedRev = N(churn.rows[0]?.churned_rev_paise);

    const startRev = N(nrr.rows[0]?.start_rev);
    const retainedCurrRev = N(nrr.rows[0]?.retained_curr_rev);

    res.json({
      tenants,
      atRiskCount: tenants.filter((t) => t.atRisk).length,
      churn: {
        activePrevMonth: activePrev,
        activeCurrMonth: activeCurr,
        churnedLogos,
        logoChurnPct: activePrev > 0 ? Math.round((churnedLogos / activePrev) * 1000) / 10 : 0,
        revenueChurnedPaise: churnedRev,
      },
      nrr: {
        startRevPaise: startRev,
        retainedCurrRevPaise: retainedCurrRev,
        nrrPct: startRev > 0 ? Math.round((retainedCurrRev / startRev) * 1000) / 10 : null,
      },
      note: "Churn/NRR use recognized usage (call_debit) as the monthly revenue proxy. A tenant is 'active' in a month if it generated call usage.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ─── 4. Product Moat ─────────────────────────────────────────────────────────

function langBucket(raw: string): "english" | "hindi" | "tamil" | "hinglish" | "other" {
  const s = raw.toLowerCase();
  if (s.includes("hinglish")) return "hinglish";
  if (s.includes("hi") || s.includes("hindi")) return "hindi";
  if (s.includes("ta") || s.includes("tamil")) return "tamil";
  if (s.includes("en") || s.includes("eng")) return "english";
  return "other";
}

router.get("/admin/board/moat", async (_req, res): Promise<void> => {
  try {
    const [mem, lang, drop] = await Promise.all([
      db.execute(sql`
        select
          count(*) filter (where memory_recognized is not null)::int as tracked,
          count(*) filter (where memory_recognized is true)::int as fired
        from calls
        where ${realCallUsers} and created_at > now() - interval '90 days'
      `),
      db.execute(sql`
        select lower(primary_language) as lang, count(*)::int as n
        from calls
        where ${realCallUsers} and primary_language is not null and created_at > now() - interval '90 days'
        group by 1
      `),
      db.execute(sql`
        with dropped as (
          select c.id, c.to_number, c.created_at
          from calls c
          where (c.conversation_completed is null or c.conversation_completed = false)
            and c.user_id in (select clerk_id from users where is_test = false)
            and c.created_at > now() - interval '90 days'
        )
        select
          count(*)::int as dropped,
          count(*) filter (where exists (
            select 1 from calls c2
            where c2.to_number = dropped.to_number
              and c2.created_at > dropped.created_at
              and c2.created_at < dropped.created_at + interval '2 days'
              and (c2.conversation_completed = true or lower(c2.status) in ('completed','success'))
          ))::int as recovered
        from dropped
      `),
    ]);

    const tracked = N(mem.rows[0]?.tracked);
    const fired = N(mem.rows[0]?.fired);

    const buckets: Record<string, number> = { english: 0, hindi: 0, tamil: 0, hinglish: 0, other: 0 };
    let langTotal = 0;
    for (const r of lang.rows as Array<Record<string, unknown>>) {
      const n = N(r.n);
      buckets[langBucket(String(r.lang ?? ""))] += n;
      langTotal += n;
    }
    const languages = Object.entries(buckets).map(([key, count]) => ({
      language: key,
      count,
      pct: langTotal > 0 ? Math.round((count / langTotal) * 1000) / 10 : 0,
    }));

    const dropped = N(drop.rows[0]?.dropped);
    const recovered = N(drop.rows[0]?.recovered);

    res.json({
      windowDays: 90,
      memory: {
        trackedCalls: tracked,
        firedCalls: fired,
        firedPct: tracked > 0 ? Math.round((fired / tracked) * 1000) / 10 : null,
      },
      language: { total: langTotal, buckets: languages },
      dropRecovery: {
        droppedCalls: dropped,
        recoveredCalls: recovered,
        recoveredPct: dropped > 0 ? Math.round((recovered / dropped) * 1000) / 10 : null,
      },
      note: "Memory-fired % and language mix only count calls recorded after instrumentation shipped; older calls are excluded. Drop-recovery is derived (a dropped call followed by a completed call to the same number within 2 days).",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ─── 5. Unit Economics Deep-Dive ─────────────────────────────────────────────

router.get("/admin/board/unit-economics", async (_req, res): Promise<void> => {
  try {
    const fx = await usdToInrRate();
    const settings = await readBoardSettings();

    const [minutesRows, prov, rev, cogsByTenant, ltvRow] = await Promise.all([
      db.execute(sql`
        select coalesce(sum(duration_seconds) filter (where created_at > now() - interval '30 days'), 0)::bigint as sec_30d
        from calls where ${realCallUsers}
      `),
      db.execute(sql`
        select ue.provider, ue.service, coalesce(sum(ue.estimated_cost_micros), 0)::bigint as cost_micros
        from usage_events ue join calls c on c.id = ue.call_id
        where ue.created_at > now() - interval '30 days'
          and c.user_id in (select clerk_id from users where is_test = false)
        group by ue.provider, ue.service
        order by cost_micros desc
      `),
      db.execute(sql`
        select u.clerk_id, u.name, u.email, coalesce(sum(abs(wt.amount_cents)), 0)::bigint as rev
        from wallet_transactions wt join users u on u.id = wt.user_id
        where wt.type = 'call_debit' and u.is_test = false and wt.created_at > now() - interval '90 days'
        group by u.clerk_id, u.name, u.email
      `),
      db.execute(sql`
        select c.user_id as clerk_id, coalesce(sum(ue.estimated_cost_micros), 0)::bigint as cost_micros
        from usage_events ue join calls c on c.id = ue.call_id
        where ue.created_at > now() - interval '90 days'
          and c.user_id in (select clerk_id from users where is_test = false)
        group by c.user_id
      `),
      db.execute(sql`
        with per as (
          select wt.user_id, sum(abs(wt.amount_cents)) as rev
          from wallet_transactions wt join users u on u.id = wt.user_id
          where wt.type = 'call_debit' and u.is_test = false
          group by wt.user_id
        )
        select coalesce(avg(rev), 0)::bigint as avg_ltv, count(*)::int as payers from per where rev > 0
      `),
    ]);

    const minutes30 = N(minutesRows.rows[0]?.sec_30d) / 60;

    const providers = (prov.rows as Array<Record<string, unknown>>).map((r) => {
      const costPaise = microsUsdToPaise(N(r.cost_micros), fx);
      return {
        provider: String(r.provider),
        service: String(r.service),
        costPaise,
        costPerMinPaise: minutes30 > 0 ? Math.round(costPaise / minutes30) : 0,
      };
    });
    // Telephony is admin-entered (not in usage_events).
    if (settings.telephonyCostPaisePerMin > 0) {
      providers.push({
        provider: "Vobiz (telephony)",
        service: "telephony",
        costPaise: Math.round(settings.telephonyCostPaisePerMin * minutes30),
        costPerMinPaise: settings.telephonyCostPaisePerMin,
      });
    }
    const totalCostPerMinPaise = providers.reduce((a, p) => a + p.costPerMinPaise, 0);

    const cogsMap = new Map<string, number>();
    for (const r of cogsByTenant.rows as Array<Record<string, unknown>>) {
      cogsMap.set(String(r.clerk_id), microsUsdToPaise(N(r.cost_micros), fx));
    }
    const marginByTenant = (rev.rows as Array<Record<string, unknown>>)
      .map((r) => {
        const clerkId = String(r.clerk_id);
        const revenuePaise = N(r.rev);
        const cogsPaise = cogsMap.get(clerkId) ?? 0;
        const marginPaise = revenuePaise - cogsPaise;
        return {
          clerkId,
          name: r.name ? String(r.name) : null,
          email: r.email ? String(r.email) : null,
          revenuePaise,
          cogsPaise,
          marginPaise,
          marginPct: revenuePaise > 0 ? Math.round((marginPaise / revenuePaise) * 1000) / 10 : null,
          unprofitable: marginPaise < 0,
        };
      })
      .filter((t) => t.revenuePaise > 0 || t.cogsPaise > 0)
      .sort((a, b) => a.marginPaise - b.marginPaise)
      .slice(0, 50);

    const ltvPaise = N(ltvRow.rows[0]?.avg_ltv);
    const cacPaise = settings.cacPaise;

    res.json({
      usdToInrRate: fx,
      minutes30: Math.round(minutes30),
      providers,
      totalCostPerMinPaise,
      marginByTenant,
      cacLtv: {
        cacPaise,
        ltvPaise,
        payers: N(ltvRow.rows[0]?.payers),
        ratio: cacPaise > 0 ? Math.round((ltvPaise / cacPaise) * 100) / 100 : null,
      },
      note: "Cost/min by provider from usage_events (USD→INR @ FX); telephony line is admin-entered. LTV = avg lifetime recognized per paying user. CAC is admin-entered.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

export default router;

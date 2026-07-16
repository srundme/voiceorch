/**
 * Admin call volume analytics — week / month / year time series.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";

const router = Router();
router.use("/admin/analytics", requireAdmin);

type Preset = "week" | "month" | "year";

function resolvePreset(raw: unknown): {
  preset: Preset;
  from: Date;
  to: Date;
  bucket: "day" | "month";
} {
  const to = new Date();
  const preset: Preset =
    raw === "week" || raw === "year" || raw === "month" ? raw : "month";

  if (preset === "week") {
    const from = new Date(to);
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - 6);
    return { preset, from, to, bucket: "day" };
  }
  if (preset === "year") {
    const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 11, 1));
    return { preset, from, to, bucket: "month" };
  }
  const from = new Date(to);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - 29);
  return { preset, from, to, bucket: "day" };
}

function formatPeriod(d: Date, bucket: "day" | "month"): string {
  if (bucket === "month") {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function enumerateBuckets(from: Date, to: Date, bucket: "day" | "month"): string[] {
  const periods: string[] = [];
  if (bucket === "month") {
    const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
    while (cur <= end) {
      periods.push(formatPeriod(cur, "month"));
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
    return periods;
  }
  const cur = new Date(from);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cur <= end) {
    periods.push(formatPeriod(cur, "day"));
    cur.setDate(cur.getDate() + 1);
  }
  return periods;
}

// GET /api/admin/analytics/calls?preset=week|month|year&segment=real|test|all
router.get("/admin/analytics/calls", async (req, res): Promise<void> => {
  try {
    const { preset, from, to, bucket } = resolvePreset(req.query.preset);

    // Real vs. test/internal user segmentation (default: real users only).
    const segment = req.query.segment === "test" ? "test" : req.query.segment === "all" ? "all" : "real";
    const segFilter =
      segment === "all"
        ? sql``
        : sql` and user_id in (select clerk_id from users where is_test = ${segment === "test"})`;

    const result =
      bucket === "month"
        ? await db.execute(sql`
            select
              to_char(date_trunc('month', created_at), 'YYYY-MM') as period,
              count(*)::int as total,
              count(*) filter (where status = 'completed')::int as completed,
              count(*) filter (where status = 'failed')::int as failed
            from calls
            where created_at >= ${from} and created_at <= ${to}${segFilter}
            group by 1
            order by 1
          `)
        : await db.execute(sql`
            select
              to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as period,
              count(*)::int as total,
              count(*) filter (where status = 'completed')::int as completed,
              count(*) filter (where status = 'failed')::int as failed
            from calls
            where created_at >= ${from} and created_at <= ${to}${segFilter}
            group by 1
            order by 1
          `);

    const byPeriod = new Map<string, { total: number; completed: number; failed: number }>();
    for (const r of result.rows as Array<Record<string, unknown>>) {
      byPeriod.set(String(r.period), {
        total: Number(r.total ?? 0),
        completed: Number(r.completed ?? 0),
        failed: Number(r.failed ?? 0),
      });
    }

    const series = enumerateBuckets(from, to, bucket).map((period) => {
      const v = byPeriod.get(period) ?? { total: 0, completed: 0, failed: 0 };
      return { period, ...v };
    });

    const totals = series.reduce(
      (a, d) => {
        a.total += d.total;
        a.completed += d.completed;
        a.failed += d.failed;
        return a;
      },
      { total: 0, completed: 0, failed: 0 },
    );

    res.json({
      preset,
      from: from.toISOString(),
      to: to.toISOString(),
      bucket,
      totals,
      series,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

export default router;

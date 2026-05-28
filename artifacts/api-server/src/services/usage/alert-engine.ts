import { db, adminAlertsTable, providerAllocationsTable, usageEventsTable } from "@workspace/db";
import { and, eq, sql, gt } from "drizzle-orm";
import { logger } from "../../lib/logger.js";

export type AlertType =
  | "low_balance"
  | "threshold_80"
  | "threshold_90"
  | "threshold_100"
  | "error_spike"
  | "usage_spike"
  | "provider_down";

interface CreateAlertOpts {
  type: AlertType;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  service?: string | null;
  provider?: string | null;
  model?: string | null;
  payload?: Record<string, unknown> | null;
  dedupeKey: string;
}

async function createAlert(opts: CreateAlertOpts): Promise<void> {
  try {
    await db
      .insert(adminAlertsTable)
      .values({
        type: opts.type,
        severity: opts.severity,
        title: opts.title,
        message: opts.message,
        service: opts.service ?? null,
        provider: opts.provider ?? null,
        model: opts.model ?? null,
        payload: opts.payload ?? null,
        dedupeKey: opts.dedupeKey,
      })
      .onConflictDoNothing({ target: adminAlertsTable.dedupeKey });
  } catch (err) {
    logger.warn({ err, opts }, "createAlert failed");
  }
}

function todayBucket(): string {
  return new Date().toISOString().slice(0, 10);
}

function hourBucket(): string {
  return new Date().toISOString().slice(0, 13);
}

export async function evaluateAlertsAfterEvent(opts: {
  service: string;
  provider: string;
  model: string;
  success: boolean;
  estimatedCostMicros: number;
}): Promise<void> {
  await Promise.all([
    evaluateAllocationThresholds(opts.service, opts.provider),
    evaluateErrorSpike(opts.service, opts.provider),
  ]);

  if (!opts.success) {
    await evaluateProviderDowntime(opts.service, opts.provider);
  }
}

async function evaluateAllocationThresholds(service: string, provider: string): Promise<void> {
  // Evaluate every allocation row for this (service, provider) — both the
  // global allocation (workspaceId IS NULL) and any per-workspace allocations.
  const allocations = await db
    .select()
    .from(providerAllocationsTable)
    .where(
      and(
        eq(providerAllocationsTable.service, service),
        eq(providerAllocationsTable.provider, provider),
      ),
    );

  if (allocations.length === 0) return;

  for (const alloc of allocations) {
    const allocated = Number(alloc.allocatedCostMicros);
    if (allocated <= 0) continue;

    // Usage scope must match the allocation scope: a per-workspace allocation
    // only counts events for that workspace; the global allocation counts all.
    const usageFilters = [
      eq(usageEventsTable.service, service),
      eq(usageEventsTable.provider, provider),
    ];
    if (alloc.workspaceId != null) {
      usageFilters.push(eq(usageEventsTable.workspaceId, alloc.workspaceId));
    }
    const [usageRow] = await db
      .select({
        used: sql<string>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
      })
      .from(usageEventsTable)
      .where(and(...usageFilters));

    const used = Number(usageRow?.used ?? 0);
    const remaining = allocated - used;
    const pctUsed = (used / allocated) * 100;
    const bucket = todayBucket();
    const scope = alloc.workspaceId ?? "global";
    const scopeLabel = alloc.workspaceId ? ` [workspace ${alloc.workspaceId}]` : "";

    if (alloc.lowBalanceThresholdMicros > 0 && remaining <= Number(alloc.lowBalanceThresholdMicros)) {
      await createAlert({
        type: "low_balance",
        severity: "warning",
        title: `Low balance: ${provider} (${service.toUpperCase()})${scopeLabel}`,
        message: `Remaining budget for ${provider}${scopeLabel} is below the configured low-balance threshold.`,
        service,
        provider,
        payload: { allocated, used, remaining, workspaceId: alloc.workspaceId },
        dedupeKey: `low_balance:${service}:${provider}:${scope}:${bucket}`,
      });
    }

    if (pctUsed >= 100) {
      await createAlert({
        type: "threshold_100",
        severity: "critical",
        title: `${provider} (${service.toUpperCase()})${scopeLabel} allocation exhausted`,
        message: `100% of the allocated budget has been consumed.`,
        service,
        provider,
        payload: { allocated, used, pctUsed, workspaceId: alloc.workspaceId },
        dedupeKey: `threshold_100:${service}:${provider}:${scope}:${bucket}`,
      });
    } else if (pctUsed >= 90) {
      await createAlert({
        type: "threshold_90",
        severity: "warning",
        title: `${provider} (${service.toUpperCase()})${scopeLabel} at 90% of allocation`,
        message: `Usage has crossed 90% of the allocated budget.`,
        service,
        provider,
        payload: { allocated, used, pctUsed, workspaceId: alloc.workspaceId },
        dedupeKey: `threshold_90:${service}:${provider}:${scope}:${bucket}`,
      });
    } else if (pctUsed >= 80) {
      await createAlert({
        type: "threshold_80",
        severity: "info",
        title: `${provider} (${service.toUpperCase()})${scopeLabel} at 80% of allocation`,
        message: `Usage has crossed 80% of the allocated budget.`,
        service,
        provider,
        payload: { allocated, used, pctUsed, workspaceId: alloc.workspaceId },
        dedupeKey: `threshold_80:${service}:${provider}:${scope}:${bucket}`,
      });
    }
  }
}

async function evaluateErrorSpike(service: string, provider: string): Promise<void> {
  const [row] = await db
    .select({
      total: sql<string>`count(*)`,
      failed: sql<string>`count(*) filter (where ${usageEventsTable.success} = false)`,
    })
    .from(usageEventsTable)
    .where(
      and(
        eq(usageEventsTable.service, service),
        eq(usageEventsTable.provider, provider),
        gt(usageEventsTable.createdAt, sql`now() - interval '15 minutes'`),
      ),
    );
  const total = Number(row?.total ?? 0);
  const failed = Number(row?.failed ?? 0);
  if (total < 10) return;
  const rate = failed / total;
  if (rate >= 0.25) {
    await createAlert({
      type: "error_spike",
      severity: rate >= 0.5 ? "critical" : "warning",
      title: `Error spike: ${provider} (${service.toUpperCase()})`,
      message: `${Math.round(rate * 100)}% of ${provider} calls in the last 15 minutes failed (${failed}/${total}).`,
      service,
      provider,
      payload: { total, failed, rate },
      dedupeKey: `error_spike:${service}:${provider}:${hourBucket()}`,
    });
  }
}

async function evaluateProviderDowntime(service: string, provider: string): Promise<void> {
  const [row] = await db
    .select({
      total: sql<string>`count(*)`,
      failed: sql<string>`count(*) filter (where ${usageEventsTable.success} = false)`,
    })
    .from(usageEventsTable)
    .where(
      and(
        eq(usageEventsTable.service, service),
        eq(usageEventsTable.provider, provider),
        gt(usageEventsTable.createdAt, sql`now() - interval '5 minutes'`),
      ),
    );
  const total = Number(row?.total ?? 0);
  const failed = Number(row?.failed ?? 0);
  if (total >= 5 && failed === total) {
    await createAlert({
      type: "provider_down",
      severity: "critical",
      title: `${provider} (${service.toUpperCase()}) appears down`,
      message: `All ${total} calls to ${provider} in the last 5 minutes failed.`,
      service,
      provider,
      payload: { total, failed },
      dedupeKey: `provider_down:${service}:${provider}:${hourBucket()}`,
    });
  }
}

// Periodic sweep — detects usage spikes (rolling baseline) and re-evaluates
// allocation thresholds for inactive providers.
export async function sweepAlerts(): Promise<void> {
  try {
    // Per (service, provider) totals for today vs 14-day average
    const rows = await db
      .select({
        service: usageEventsTable.service,
        provider: usageEventsTable.provider,
        today: sql<string>`coalesce(sum(${usageEventsTable.estimatedCostMicros}) filter (where ${usageEventsTable.createdAt} > current_date::timestamptz), 0)`,
        baseline: sql<string>`coalesce(sum(${usageEventsTable.estimatedCostMicros}) filter (where ${usageEventsTable.createdAt} > now() - interval '14 days' and ${usageEventsTable.createdAt} <= current_date::timestamptz) / 14.0, 0)`,
      })
      .from(usageEventsTable)
      .where(gt(usageEventsTable.createdAt, sql`now() - interval '14 days'`))
      .groupBy(usageEventsTable.service, usageEventsTable.provider);

    for (const r of rows) {
      const today = Number(r.today);
      const baseline = Number(r.baseline);
      if (baseline > 0 && today >= baseline * 3 && today > 100_000) {
        await createAlert({
          type: "usage_spike",
          severity: "warning",
          title: `Usage spike: ${r.provider} (${r.service.toUpperCase()})`,
          message: `Today's spend is ${(today / baseline).toFixed(1)}× the 14-day average.`,
          service: r.service,
          provider: r.provider,
          payload: { today, baseline },
          dedupeKey: `usage_spike:${r.service}:${r.provider}:${todayBucket()}`,
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, "sweepAlerts failed");
  }
}

let sweepStarted = false;
export function startAlertSweep(intervalMs = 5 * 60 * 1000): void {
  if (sweepStarted) return;
  sweepStarted = true;
  setInterval(() => {
    void sweepAlerts();
  }, intervalMs).unref?.();
}

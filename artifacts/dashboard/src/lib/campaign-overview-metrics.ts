type AnalyticsMetrics = {
  imported?: number;
  called?: number;
  failed?: number;
  busy?: number;
  noPickup?: number;
  connected?: number;
  totalLeads?: number;
  calledLeads?: number;
  interested?: number;
  successRate?: number;
  statusBreakdown?: Record<string, number>;
};

type CampaignMetrics = {
  totalLeads?: number;
  calledLeads?: number;
};

function asCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Must match api-server `campaign-lead-funnel.ts`. */
const CONNECTED_CALL_STATUSES = ["connected", "completed", "transferred"] as const;

function sumStatuses(breakdown: Record<string, number> | undefined, keys: readonly string[]): number {
  if (!breakdown) return 0;
  return keys.reduce((sum, key) => sum + (breakdown[key] ?? 0), 0);
}

/**
 * Overview tiles follow GET /campaigns/:id/analytics (same buckets as batch
 * workspace KPIs). Live Queue is not mixed in — that route uses different
 * meanings (connected = in-progress, failed = exhausted).
 */
export function resolveCampaignOverviewMetrics(input: {
  analytics?: AnalyticsMetrics | null;
  campaign?: CampaignMetrics | null;
}) {
  const a = input.analytics;
  const breakdown = a?.statusBreakdown;

  const imported = asCount(a?.imported)
    ?? asCount(a?.totalLeads)
    ?? asCount(input.campaign?.totalLeads)
    ?? 0;

  const called = asCount(a?.called)
    ?? asCount(a?.calledLeads)
    ?? asCount(input.campaign?.calledLeads)
    ?? 0;

  const connected = asCount(a?.connected)
    ?? (breakdown ? sumStatuses(breakdown, CONNECTED_CALL_STATUSES) : 0);

  const failed = asCount(a?.failed)
    ?? (breakdown ? (breakdown["failed"] ?? 0) : 0);
  const busy = asCount(a?.busy)
    ?? (breakdown ? (breakdown["busy"] ?? 0) : 0);
  const noPickup = asCount(a?.noPickup)
    ?? (breakdown ? (breakdown["no_pickup"] ?? 0) : 0);

  const interested = asCount(a?.interested);
  const successRate = asCount(a?.successRate)
    ?? (called > 0 && interested != null ? Math.round((interested / called) * 100) : 0);

  return { imported, called, failed, busy, noPickup, connected, successRate };
}

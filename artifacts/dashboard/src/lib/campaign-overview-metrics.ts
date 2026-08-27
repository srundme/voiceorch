type AnalyticsMetrics = {
  imported?: number;
  called?: number;
  failed?: number;
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

type LiveMetrics = {
  total?: number;
  queued?: number;
  nopickup?: number;
  failed?: number;
};

function asCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function connectedFromBreakdown(breakdown?: Record<string, number>): number | undefined {
  if (!breakdown) return undefined;
  return (breakdown["connected"] ?? 0) + (breakdown["completed"] ?? 0) + (breakdown["transferred"] ?? 0);
}

/**
 * Campaign analytics is authoritative once loaded. In particular, a valid zero
 * must never fall through to a non-zero Live Queue estimate.
 *
 * OpenAPI required fields are `totalLeads` / `calledLeads`; `imported` /
 * `called` / `connected` are optional aliases. Read both so the overview tiles
 * cannot sit at 0 while the lead table already shows completed calls.
 */
export function resolveCampaignOverviewMetrics(input: {
  analytics?: AnalyticsMetrics | null;
  campaign?: CampaignMetrics | null;
  live?: LiveMetrics | null;
}) {
  const liveTotal = input.live?.total ?? 0;
  const liveQueued = input.live?.queued ?? 0;
  const hasAnalytics = input.analytics != null;
  const a = input.analytics;

  const imported = asCount(a?.imported)
    ?? asCount(a?.totalLeads)
    ?? (!hasAnalytics ? input.campaign?.totalLeads ?? liveTotal : 0);

  const called = asCount(a?.called)
    ?? asCount(a?.calledLeads)
    ?? (!hasAnalytics ? input.campaign?.calledLeads ?? Math.max(0, liveTotal - liveQueued) : 0);

  const connected = asCount(a?.connected)
    ?? (hasAnalytics ? connectedFromBreakdown(a?.statusBreakdown) ?? 0 : 0);

  const failed = asCount(a?.failed)
    ?? (!hasAnalytics ? (input.live?.nopickup ?? 0) + (input.live?.failed ?? 0) : 0);

  const interested = asCount(a?.interested);
  const successRate = asCount(a?.successRate)
    ?? (called > 0 && interested != null ? Math.round((interested / called) * 100) : 0);

  return { imported, called, failed, connected, successRate };
}

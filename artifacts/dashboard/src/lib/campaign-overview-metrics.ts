type AnalyticsMetrics = {
  imported?: number;
  called?: number;
  failed?: number;
  connected?: number;
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

/**
 * Campaign analytics is authoritative once loaded. In particular, a valid zero
 * must never fall through to a non-zero Live Queue estimate.
 */
export function resolveCampaignOverviewMetrics(input: {
  analytics?: AnalyticsMetrics | null;
  campaign?: CampaignMetrics | null;
  live?: LiveMetrics | null;
}) {
  const liveTotal = input.live?.total ?? 0;
  const liveQueued = input.live?.queued ?? 0;
  const hasAnalytics = input.analytics != null;

  return {
    imported: hasAnalytics
      ? input.analytics?.imported ?? 0
      : input.campaign?.totalLeads ?? liveTotal,
    called: hasAnalytics
      ? input.analytics?.called ?? 0
      : input.campaign?.calledLeads ?? Math.max(0, liveTotal - liveQueued),
    failed: hasAnalytics
      ? input.analytics?.failed ?? 0
      : (input.live?.nopickup ?? 0) + (input.live?.failed ?? 0),
    connected: hasAnalytics ? input.analytics?.connected ?? 0 : 0,
  };
}

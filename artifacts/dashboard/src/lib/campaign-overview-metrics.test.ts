import { describe, expect, it } from "vitest";
import { resolveCampaignOverviewMetrics } from "./campaign-overview-metrics";

describe("resolveCampaignOverviewMetrics", () => {
  it("preserves authoritative zero analytics values", () => {
    expect(resolveCampaignOverviewMetrics({
      analytics: { imported: 0, called: 0, failed: 0, connected: 0 },
      campaign: { totalLeads: 12, calledLeads: 8 },
      live: { total: 12, queued: 2, nopickup: 3, failed: 2 },
    })).toEqual({ imported: 0, called: 0, failed: 0, connected: 0, successRate: 0 });
  });

  it("uses Live Queue estimates only before analytics loads", () => {
    expect(resolveCampaignOverviewMetrics({
      live: { total: 12, queued: 2, nopickup: 3, failed: 2 },
    })).toEqual({ imported: 12, called: 10, failed: 5, connected: 0, successRate: 0 });
  });

  it("reads OpenAPI totalLeads/calledLeads/statusBreakdown when aliases are omitted", () => {
    expect(resolveCampaignOverviewMetrics({
      analytics: {
        totalLeads: 2,
        calledLeads: 2,
        interested: 1,
        statusBreakdown: { completed: 2 },
      },
      campaign: { totalLeads: 2, calledLeads: 2 },
    })).toEqual({ imported: 2, called: 2, failed: 0, connected: 2, successRate: 50 });
  });
});

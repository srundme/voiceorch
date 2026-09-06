import { describe, expect, it } from "vitest";
import { resolveCampaignOverviewMetrics } from "./campaign-overview-metrics";

describe("resolveCampaignOverviewMetrics", () => {
  it("uses GET /campaigns/:id/analytics funnel fields", () => {
    expect(resolveCampaignOverviewMetrics({
      analytics: { imported: 151, called: 151, failed: 71, busy: 28, noPickup: 5, connected: 33, interested: 2, successRate: 1 },
      campaign: { totalLeads: 57, calledLeads: 71 },
    })).toEqual({ imported: 151, called: 151, failed: 71, busy: 28, noPickup: 5, connected: 33, successRate: 1 });
  });

  it("does not mix Live Queue or stale campaign counters over analytics zeros", () => {
    expect(resolveCampaignOverviewMetrics({
      analytics: { imported: 0, called: 0, failed: 0, connected: 0 },
      campaign: { totalLeads: 12, calledLeads: 8 },
    })).toEqual({ imported: 0, called: 0, failed: 0, busy: 0, noPickup: 0, connected: 0, successRate: 0 });
  });

  it("reads OpenAPI totalLeads/calledLeads/statusBreakdown when aliases are omitted", () => {
    expect(resolveCampaignOverviewMetrics({
      analytics: {
        totalLeads: 151,
        calledLeads: 151,
        interested: 2,
        statusBreakdown: { completed: 33, failed: 90, busy: 10, no_pickup: 4, voicemail: 14 },
      },
      campaign: { totalLeads: 57, calledLeads: 71 },
    })).toEqual({ imported: 151, called: 151, failed: 90, busy: 10, noPickup: 4, connected: 33, successRate: 1 });
  });

  it("falls back to campaign row only when analytics has not loaded", () => {
    expect(resolveCampaignOverviewMetrics({
      campaign: { totalLeads: 151, calledLeads: 151 },
    })).toEqual({ imported: 151, called: 151, failed: 0, busy: 0, noPickup: 0, connected: 0, successRate: 0 });
  });
});

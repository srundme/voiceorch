import { describe, expect, it } from "vitest";
import { resolveCampaignOverviewMetrics } from "./campaign-overview-metrics";

describe("resolveCampaignOverviewMetrics", () => {
  it("preserves authoritative zero analytics values", () => {
    expect(resolveCampaignOverviewMetrics({
      analytics: { imported: 0, called: 0, failed: 0, connected: 0 },
      campaign: { totalLeads: 12, calledLeads: 8 },
      live: { total: 12, queued: 2, nopickup: 3, failed: 2 },
    })).toEqual({ imported: 0, called: 0, failed: 0, connected: 0 });
  });

  it("uses Live Queue estimates only before analytics loads", () => {
    expect(resolveCampaignOverviewMetrics({
      live: { total: 12, queued: 2, nopickup: 3, failed: 2 },
    })).toEqual({ imported: 12, called: 10, failed: 5, connected: 0 });
  });
});

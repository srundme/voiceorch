import { describe, it, expect } from "vitest";

/** Mirrors the no-pickup / failed status set used by Re-campaign. */
const NO_PICKUP_STATUSES = ["failed", "no_pickup", "busy", "skipped"] as const;

function estimateRecampaignCount(opts: {
  dispositions: Array<{ label: string; count: number }>;
  selectedDispositions: string[];
  statusBreakdown: Record<string, number>;
  includeNoPickup: boolean;
}): number {
  let total = 0;
  for (const d of opts.dispositions) {
    if (opts.selectedDispositions.includes(d.label)) total += d.count;
  }
  if (opts.includeNoPickup) {
    total += NO_PICKUP_STATUSES.reduce((sum, s) => sum + (opts.statusBreakdown[s] ?? 0), 0);
  }
  return total;
}

describe("re-campaign estimate", () => {
  it("sums selected disposition slices", () => {
    expect(
      estimateRecampaignCount({
        dispositions: [
          { label: "not interested", count: 12 },
          { label: "interested", count: 4 },
        ],
        selectedDispositions: ["not interested"],
        statusBreakdown: {},
        includeNoPickup: false,
      }),
    ).toBe(12);
  });

  it("adds no-pickup / failed statuses when selected", () => {
    expect(
      estimateRecampaignCount({
        dispositions: [{ label: "partially interested", count: 3 }],
        selectedDispositions: ["partially interested"],
        statusBreakdown: { failed: 5, no_pickup: 2, busy: 1, skipped: 1, completed: 40 },
        includeNoPickup: true,
      }),
    ).toBe(12);
  });
});

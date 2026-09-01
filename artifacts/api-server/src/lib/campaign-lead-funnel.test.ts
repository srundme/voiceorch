import { describe, expect, it } from "vitest";
import { funnelFromRow } from "./campaign-lead-funnel";

describe("funnelFromRow", () => {
  it("computes successRate as interested / called like batch KPIs", () => {
    expect(funnelFromRow({
      imported: 151,
      called: 151,
      connected: 33,
      interested: 2,
      booked: 0,
      transferred: 0,
      failed: 71,
      busy: 28,
      noPickup: 5,
      voicemail: 14,
      pending: 0,
    })).toMatchObject({
      imported: 151,
      called: 151,
      connected: 33,
      failed: 71,
      busy: 28,
      noPickup: 5,
      successRate: 1,
    });
  });
});

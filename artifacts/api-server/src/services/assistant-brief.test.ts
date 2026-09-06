import { describe, expect, it } from "vitest";
import { minutesFromWallet, recommendationsFromSnapshot, type WorkspaceSnapshot } from "./assistant-brief.js";

function snap(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    agentCount: 1,
    draftAgents: [],
    liveAgents: [{ id: 12, name: "Priya" }],
    campaignCount: 1,
    activeCampaigns: [],
    phoneCount: 1,
    unassignedPhones: [],
    whatsappReady: false,
    walletBalanceCents: 80_000,
    failedCallsRecent: 0,
    firstAgentId: 12,
    ...over,
  };
}

describe("recommendationsFromSnapshot", () => {
  it("stops at create-agent when the workspace is empty", () => {
    const recs = recommendationsFromSnapshot(snap({
      agentCount: 0,
      liveAgents: [],
      firstAgentId: null,
      campaignCount: 0,
      phoneCount: 0,
    }));
    expect(recs.map((r) => r.id)).toEqual(["create-agent"]);
  });

  it("flags missing channels and unpublished drafts", () => {
    const recs = recommendationsFromSnapshot(snap({
      phoneCount: 0,
      campaignCount: 0,
      liveAgents: [],
      draftAgents: [{ id: 3, name: "New Agent" }],
      firstAgentId: 3,
    }));
    expect(recs.map((r) => r.id)).toEqual([
      "connect-channel",
      "create-campaign",
      "publish-agent",
    ]);
  });

  it("asks to assign an unused number", () => {
    const recs = recommendationsFromSnapshot(snap({
      phoneCount: 1,
      unassignedPhones: [{ id: 9, number: "+918012345678" }],
      campaignCount: 2,
    }));
    expect(recs.some((r) => r.id === "assign-phone")).toBe(true);
  });

  it("surfaces low wallet and failed calls", () => {
    const recs = recommendationsFromSnapshot(snap({
      walletBalanceCents: 2_000,
      failedCallsRecent: 6,
    }));
    expect(recs.map((r) => r.id)).toEqual(["top-up-wallet", "review-failures"]);
  });

  it("falls back to a test-agent nudge when healthy", () => {
    const recs = recommendationsFromSnapshot(snap());
    expect(recs.map((r) => r.id)).toEqual(["test-agent"]);
  });
});

describe("minutesFromWallet", () => {
  it("uses the ₹5/min managed rate", () => {
    expect(minutesFromWallet(8097_00)).toBe(1619);
    expect(minutesFromWallet(0)).toBe(0);
  });
});

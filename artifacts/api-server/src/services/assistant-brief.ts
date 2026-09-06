export type WorkspaceSnapshot = {
  agentCount: number;
  draftAgents: Array<{ id: number; name: string }>;
  liveAgents: Array<{ id: number; name: string }>;
  campaignCount: number;
  activeCampaigns: Array<{ id: number; name: string }>;
  phoneCount: number;
  unassignedPhones: Array<{ id: number; number: string }>;
  whatsappReady: boolean;
  walletBalanceCents: number;
  failedCallsRecent: number;
  firstAgentId: number | null;
};

export type AssistantRecommendation = {
  id: string;
  title: string;
  reason: string;
  href: string;
  priority: "high" | "medium" | "low";
};

const LOW_WALLET_PAISE = 10_000;
const MINUTE_RATE_PAISE = 500;

export function minutesFromWallet(balanceCents: number): number {
  return Math.floor(Math.max(0, balanceCents) / MINUTE_RATE_PAISE);
}

/** Ranked next steps from live workspace state — not LLM guesses. */
export function recommendationsFromSnapshot(s: WorkspaceSnapshot): AssistantRecommendation[] {
  const recs: AssistantRecommendation[] = [];

  if (s.agentCount === 0) {
    recs.push({
      id: "create-agent",
      title: "Create your first agent",
      reason: "Nothing can answer or dial until an agent exists.",
      href: "/app/agents?create=1",
      priority: "high",
    });
    return recs;
  }

  if (s.phoneCount === 0 && !s.whatsappReady) {
    recs.push({
      id: "connect-channel",
      title: "Connect a phone or WhatsApp",
      reason: "No inbound number and no WhatsApp channel — callers cannot reach you.",
      href: "/app/connections",
      priority: "high",
    });
  }

  if (s.phoneCount > 0 && s.unassignedPhones.length === s.phoneCount && s.firstAgentId) {
    recs.push({
      id: "assign-phone",
      title: "Assign a number to an agent",
      reason: `${s.unassignedPhones[0]!.number} is sitting unused. Assign it so inbound rings the agent.`,
      href: `/app/agents/${s.firstAgentId}`,
      priority: "high",
    });
  }

  if (s.campaignCount === 0) {
    recs.push({
      id: "create-campaign",
      title: "Create a campaign",
      reason: "You have an agent but no lead list. A campaign is how outbound dials start.",
      href: "/app/campaigns",
      priority: "high",
    });
  }

  if (s.draftAgents.length > 0 && s.liveAgents.length === 0) {
    const draft = s.draftAgents[0]!;
    recs.push({
      id: "publish-agent",
      title: `Publish ${draft.name}`,
      reason: "This agent is still a draft. Activate it before real calls.",
      href: `/app/agents/${draft.id}`,
      priority: "medium",
    });
  }

  if (s.walletBalanceCents < LOW_WALLET_PAISE) {
    recs.push({
      id: "top-up-wallet",
      title: "Top up the wallet",
      reason: `About ${minutesFromWallet(s.walletBalanceCents)} minutes left. Outbound will stop when the balance hits zero.`,
      href: "/app/wallet",
      priority: "high",
    });
  }

  if (s.failedCallsRecent > 0) {
    recs.push({
      id: "review-failures",
      title: `Review ${s.failedCallsRecent} failed call${s.failedCallsRecent === 1 ? "" : "s"}`,
      reason: "Recent dials failed. Check provider errors before you start another batch.",
      href: "/app/history",
      priority: "medium",
    });
  }

  if (s.activeCampaigns.length > 0) {
    const campaign = s.activeCampaigns[0]!;
    recs.push({
      id: "watch-campaign",
      title: `Check ${campaign.name}`,
      reason: "This campaign is live. Watch completions and failed leads before adding more.",
      href: `/app/campaigns/${campaign.id}`,
      priority: "low",
    });
  }

  if (recs.length === 0) {
    recs.push({
      id: "test-agent",
      title: "Test an agent",
      reason: "Workspace looks ready. Run a webcall before spending minutes on a campaign.",
      href: s.firstAgentId ? `/app/agents/${s.firstAgentId}` : "/app/agents",
      priority: "low",
    });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return recs.sort((a, b) => rank[a.priority] - rank[b.priority]).slice(0, 4);
}

export function formatBriefForLlm(s: WorkspaceSnapshot): string {
  return JSON.stringify({
    agents: {
      total: s.agentCount,
      drafts: s.draftAgents,
      live: s.liveAgents,
    },
    campaigns: {
      total: s.campaignCount,
      active: s.activeCampaigns,
    },
    phones: {
      total: s.phoneCount,
      unassigned: s.unassignedPhones,
    },
    whatsappReady: s.whatsappReady,
    walletInr: Math.round(s.walletBalanceCents / 100),
    minutesLeft: minutesFromWallet(s.walletBalanceCents),
    failedCalls: s.failedCallsRecent,
    recommended: recommendationsFromSnapshot(s),
  });
}

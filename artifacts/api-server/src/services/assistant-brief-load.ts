import { db, agentsTable, callsTable, campaignsTable, phoneNumbersTable, usersTable, whatsappChannelsTable, whatsappConnectionsTable } from "@workspace/db";
import { and, eq, ne, sql } from "drizzle-orm";
import type { WorkspaceSnapshot } from "./assistant-brief.js";

export async function loadWorkspaceSnapshot(clerkUserId: string): Promise<WorkspaceSnapshot> {
  const [agents, campaigns, phones, [user], [waChannel], waConnections, [failStats]] = await Promise.all([
    db
      .select({ id: agentsTable.id, name: agentsTable.name, status: agentsTable.status })
      .from(agentsTable)
      .where(eq(agentsTable.userId, clerkUserId))
      .limit(40),
    db
      .select({
        id: campaignsTable.id,
        name: campaignsTable.name,
        status: campaignsTable.status,
        isActive: campaignsTable.isActive,
      })
      .from(campaignsTable)
      .where(eq(campaignsTable.userId, clerkUserId))
      .limit(40),
    db
      .select({
        id: phoneNumbersTable.id,
        number: phoneNumbersTable.number,
        agentId: phoneNumbersTable.agentId,
      })
      .from(phoneNumbersTable)
      .where(and(
        eq(phoneNumbersTable.userId, clerkUserId),
        eq(phoneNumbersTable.status, "active"),
        ne(phoneNumbersTable.service, "whatsapp"),
      ))
      .limit(40),
    db
      .select({ walletBalanceCents: usersTable.walletBalanceCents })
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkUserId))
      .limit(1),
    db
      .select({ active: whatsappChannelsTable.active, status: whatsappChannelsTable.status })
      .from(whatsappChannelsTable)
      .where(eq(whatsappChannelsTable.userId, clerkUserId))
      .limit(1),
    db
      .select({ active: whatsappConnectionsTable.active })
      .from(whatsappConnectionsTable)
      .where(eq(whatsappConnectionsTable.userId, clerkUserId))
      .limit(20),
    db
      .select({ failed: sql<number>`count(*) filter (where status in ('failed', 'error'))::int` })
      .from(callsTable)
      .where(eq(callsTable.userId, clerkUserId)),
  ]);

  const draftAgents = agents
    .filter((a) => (a.status ?? "draft") === "draft")
    .map((a) => ({ id: a.id, name: a.name || `Agent #${a.id}` }));
  const liveAgents = agents
    .filter((a) => a.status === "active")
    .map((a) => ({ id: a.id, name: a.name || `Agent #${a.id}` }));
  const activeCampaigns = campaigns
    .filter((c) => c.isActive || c.status === "active")
    .map((c) => ({ id: c.id, name: c.name }));
  const unassignedPhones = phones
    .filter((p) => !p.agentId)
    .map((p) => ({ id: p.id, number: p.number }));
  const whatsappReady =
    (waChannel?.active === true && waChannel.status !== "disabled")
    || waConnections.some((c) => c.active);

  return {
    agentCount: agents.length,
    draftAgents,
    liveAgents,
    campaignCount: campaigns.length,
    activeCampaigns,
    phoneCount: phones.length,
    unassignedPhones,
    whatsappReady,
    walletBalanceCents: user?.walletBalanceCents ?? 0,
    failedCallsRecent: failStats?.failed ?? 0,
    firstAgentId: agents[0]?.id ?? null,
  };
}

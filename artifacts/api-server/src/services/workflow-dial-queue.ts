/**
 * Call-plan dialing via the campaign engine.
 *
 * Hidden `leadSource=workflow` campaigns get a running batch and
 * `concurrentCallLimit = users.concurrentLimit`. Dialing uses the same
 * `refillCampaignConcurrency` / atomic pre-claim path as People campaigns.
 *
 * Account-wide slot counting for workflow campaigns lives in batchScheduler
 * so two agents/plans cannot exceed the account ceiling.
 */

import {
  db,
  usersTable,
  campaignsTable,
  campaignBatchesTable,
  campaignLeadsTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

type Campaign = typeof campaignsTable.$inferSelect;
type Batch = typeof campaignBatchesTable.$inferSelect;

const DEFAULT_CONCURRENT_LIMIT = 10;
const WORKFLOW_BATCH_NAME = "__call_plan_queue";

export async function getUserConcurrentLimit(clerkUserId: string): Promise<number> {
  const [user] = await db
    .select({ concurrentLimit: usersTable.concurrentLimit })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkUserId))
    .limit(1);
  const n = user?.concurrentLimit ?? DEFAULT_CONCURRENT_LIMIT;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_CONCURRENT_LIMIT;
}

/** Active dials for this account's workflow (call-plan) campaigns. */
export async function countActiveWorkflowCallsForUser(clerkUserId: string): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(campaignLeadsTable)
    .innerJoin(campaignsTable, eq(campaignLeadsTable.campaignId, campaignsTable.id))
    .where(and(
      eq(campaignsTable.userId, clerkUserId),
      eq(campaignsTable.leadSource, "workflow"),
      inArray(campaignLeadsTable.callStatus, ["calling", "connected"]),
    ));
  return Number(row?.c ?? 0);
}

/**
 * Keep workflow campaign.concurrentCallLimit + dialable status aligned with
 * the account ceiling so campaign rolling refill can run.
 */
export async function syncWorkflowCampaignConcurrency(
  campaign: Campaign,
  clerkUserId: string,
): Promise<Campaign> {
  const limit = await getUserConcurrentLimit(clerkUserId);
  const needsLimit = campaign.concurrentCallLimit !== limit;
  // Workflow campaigns must be dialable for refillCampaignConcurrency.
  const needsStatus = campaign.status === "paused" || campaign.status === "completed"
    || campaign.status === "stopped" || campaign.status === "cancelled";

  if (!needsLimit && !needsStatus && campaign.isActive) return campaign;

  const [updated] = await db
    .update(campaignsTable)
    .set({
      ...(needsLimit ? { concurrentCallLimit: limit } : {}),
      ...(needsStatus ? { status: "active" } : {}),
      isActive: true,
    })
    .where(eq(campaignsTable.id, campaign.id))
    .returning();
  return updated ?? campaign;
}

/** One long-running batch per workflow campaign — same role as a People batch. */
export async function getOrCreateWorkflowRunningBatch(campaignId: number): Promise<Batch> {
  const [running] = await db.select().from(campaignBatchesTable)
    .where(and(
      eq(campaignBatchesTable.campaignId, campaignId),
      eq(campaignBatchesTable.status, "running"),
      eq(campaignBatchesTable.name, WORKFLOW_BATCH_NAME),
    ))
    .limit(1);
  if (running) return running;

  const [anyRunning] = await db.select().from(campaignBatchesTable)
    .where(and(
      eq(campaignBatchesTable.campaignId, campaignId),
      eq(campaignBatchesTable.status, "running"),
    ))
    .orderBy(campaignBatchesTable.id)
    .limit(1);
  if (anyRunning) return anyRunning;

  const [created] = await db.insert(campaignBatchesTable).values({
    campaignId,
    name: WORKFLOW_BATCH_NAME,
    description: "Call plan dial queue (campaign engine)",
    status: "running",
    leadSource: "workflow",
    maxAttempts: 1,
    callDelaySeconds: 0,
  }).returning();
  return created!;
}

/**
 * Arm campaign + batch, then top up via the real campaign rolling refill.
 * Call after enqueueing a pending lead (beginCall) or from the worker backstop.
 */
export async function refillWorkflowDialSlots(clerkUserId: string, campaignId?: number): Promise<void> {
  try {
    // Dynamic import avoids cycle with batchScheduler → workflow-dial-queue.
    const { refillCampaignConcurrency } = await import("./batchScheduler.js");

    if (campaignId != null && campaignId > 0) {
      const [campaign] = await db.select().from(campaignsTable)
        .where(eq(campaignsTable.id, campaignId))
        .limit(1);
      if (campaign?.leadSource === "workflow") {
        await syncWorkflowCampaignConcurrency(campaign, clerkUserId);
        await getOrCreateWorkflowRunningBatch(campaign.id);
        await refillCampaignConcurrency(campaign.id);
      }
      return;
    }

    const campaigns = await db.select().from(campaignsTable)
      .where(and(
        eq(campaignsTable.userId, clerkUserId),
        eq(campaignsTable.leadSource, "workflow"),
      ));

    for (const campaign of campaigns) {
      await syncWorkflowCampaignConcurrency(campaign, clerkUserId);
      await getOrCreateWorkflowRunningBatch(campaign.id);
      await refillCampaignConcurrency(campaign.id);
    }
  } catch (err) {
    logger.error({ err, userId: clerkUserId, campaignId }, "refillWorkflowDialSlots error");
  }
}

/** Call-end path: top up this workflow campaign (and siblings for account pool). */
export async function refillWorkflowDialSlotsForLead(leadId: number): Promise<boolean> {
  try {
    const [row] = await db
      .select({
        userId: campaignsTable.userId,
        campaignId: campaignsTable.id,
        leadSource: campaignsTable.leadSource,
      })
      .from(campaignLeadsTable)
      .innerJoin(campaignsTable, eq(campaignLeadsTable.campaignId, campaignsTable.id))
      .where(eq(campaignLeadsTable.id, leadId))
      .limit(1);
    if (!row || row.leadSource !== "workflow") return false;
    await refillWorkflowDialSlots(row.userId, row.campaignId);
    // Other agents/plans share the account pool — top them up too if slots remain.
    await refillWorkflowDialSlots(row.userId);
    return true;
  } catch (err) {
    logger.error({ err, leadId }, "refillWorkflowDialSlotsForLead error");
    return false;
  }
}

/** Pause dialing for a workflow campaign (journey Pause with no other active plans). */
export async function pauseWorkflowCampaign(campaignId: number): Promise<void> {
  await db.update(campaignsTable)
    .set({ status: "paused", isActive: false })
    .where(and(
      eq(campaignsTable.id, campaignId),
      eq(campaignsTable.leadSource, "workflow"),
    ));
}

export async function pauseWorkflowCampaignsForAgent(
  userId: string,
  agentId: number,
): Promise<void> {
  await db.update(campaignsTable)
    .set({ status: "paused", isActive: false })
    .where(and(
      eq(campaignsTable.userId, userId),
      eq(campaignsTable.agentId, agentId),
      eq(campaignsTable.leadSource, "workflow"),
    ));
}

/** Pipeline buffer size ahead of concurrency. */
export function callPlanFeedBufferSize(concurrentLimit: number): number {
  return Math.min(100, Math.max(25, concurrentLimit * 3));
}

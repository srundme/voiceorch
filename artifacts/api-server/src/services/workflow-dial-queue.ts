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
  partnersTable,
  campaignsTable,
  campaignBatchesTable,
  campaignLeadsTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

type Campaign = typeof campaignsTable.$inferSelect;
type Batch = typeof campaignBatchesTable.$inferSelect;

const DEFAULT_CONCURRENT_LIMIT = Math.max(1, Number(process.env.DEFAULT_USER_CONCURRENT_LIMIT ?? 1));
const WORKFLOW_BATCH_NAME = "__call_plan_queue";

export async function getUserConcurrentLimit(clerkUserId: string): Promise<number> {
  const [partnerOwner] = await db
    .select({
      id: partnersTable.id,
      concurrentLimit: partnersTable.concurrentLimit,
    })
    .from(partnersTable)
    .where(eq(partnersTable.userId, clerkUserId))
    .limit(1);

  if (partnerOwner) {
    const pLimit = partnerOwner.concurrentLimit;
    const pool = Number.isFinite(pLimit) && pLimit > 0 ? Math.floor(pLimit) : DEFAULT_CONCURRENT_LIMIT;

    // Sum all concurrent limits allocated to clients under this partner
    const [allocatedRow] = await db
      .select({ total: sql<number>`coalesce(sum(${usersTable.concurrentLimit}), 0)` })
      .from(usersTable)
      .where(eq(usersTable.partnerId, partnerOwner.id));
    const allocated = Number(allocatedRow?.total ?? 0);

    // Partner's own available dialing capacity is the unallocated portion of their pool
    return Math.max(0, pool - allocated);
  }

  const [user] = await db
    .select({ concurrentLimit: usersTable.concurrentLimit })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkUserId))
    .limit(1);
  const n = user?.concurrentLimit ?? DEFAULT_CONCURRENT_LIMIT;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_CONCURRENT_LIMIT;
}

/** Active dials for this account across ALL campaigns. */
export async function countActiveCallsForUser(clerkUserId: string): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(campaignLeadsTable)
    .innerJoin(campaignsTable, eq(campaignLeadsTable.campaignId, campaignsTable.id))
    .where(and(
      eq(campaignsTable.userId, clerkUserId),
      inArray(campaignLeadsTable.callStatus, ["calling", "connected"]),
    ));
  return Number(row?.c ?? 0);
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

export type WorkflowCallingHours = {
  isCallingHoursEnabled?: boolean;
  businessHoursStart?: number | null;
  businessHoursEnd?: number | null;
  timezone?: string | null;
};

function clampHour(n: unknown, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(23, Math.max(0, Math.floor(v)));
}

/**
 * Keep workflow campaign concurrency + dialable status (+ optional calling hours)
 * aligned so campaign rolling refill / isCampaignDialable work like People campaigns.
 */
export async function syncWorkflowCampaignConcurrency(
  campaign: Campaign,
  clerkUserId: string,
  hours?: WorkflowCallingHours | null,
): Promise<Campaign> {
  const limit = await getUserConcurrentLimit(clerkUserId);
  const needsLimit = campaign.concurrentCallLimit !== limit;
  // Workflow campaigns must be dialable for refillCampaignConcurrency.
  const needsStatus = campaign.status === "paused" || campaign.status === "completed"
    || campaign.status === "stopped" || campaign.status === "cancelled";

  const hoursPatch: Partial<Campaign> = {};
  if (hours != null) {
    const enabled = hours.isCallingHoursEnabled !== false;
    if (enabled) {
      const start = clampHour(hours.businessHoursStart, 9);
      const end = clampHour(hours.businessHoursEnd, 19);
      const tz = typeof hours.timezone === "string" && hours.timezone.trim()
        ? hours.timezone.trim()
        : "Asia/Kolkata";
      if (
        campaign.isCallingHoursEnabled !== true
        || campaign.businessHoursStart !== start
        || campaign.businessHoursEnd !== end
        || campaign.timezone !== tz
      ) {
        hoursPatch.isCallingHoursEnabled = true;
        hoursPatch.businessHoursStart = start;
        hoursPatch.businessHoursEnd = end;
        hoursPatch.timezone = tz;
      }
    } else if (campaign.isCallingHoursEnabled !== false) {
      hoursPatch.isCallingHoursEnabled = false;
      hoursPatch.businessHoursStart = null;
      hoursPatch.businessHoursEnd = null;
    }
  }

  if (!needsLimit && !needsStatus && campaign.isActive && Object.keys(hoursPatch).length === 0) {
    return campaign;
  }

  const [updated] = await db
    .update(campaignsTable)
    .set({
      ...(needsLimit ? { concurrentCallLimit: limit } : {}),
      ...(needsStatus ? { status: "active" } : {}),
      isActive: true,
      ...hoursPatch,
    })
    .where(eq(campaignsTable.id, campaign.id))
    .returning();
  return updated ?? campaign;
}

/** Push a call plan's calling hours onto every workflow campaign for that agent. */
export async function syncCallingHoursForAgent(
  clerkUserId: string,
  agentId: number,
  hours: WorkflowCallingHours,
): Promise<void> {
  const campaigns = await db.select().from(campaignsTable)
    .where(and(
      eq(campaignsTable.userId, clerkUserId),
      eq(campaignsTable.agentId, agentId),
      eq(campaignsTable.leadSource, "workflow"),
    ));
  for (const campaign of campaigns) {
    await syncWorkflowCampaignConcurrency(campaign, clerkUserId, hours);
  }
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

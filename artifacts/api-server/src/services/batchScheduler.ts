import { db, campaignsTable, campaignBatchesTable, campaignLeadsTable } from "@workspace/db";
import { eq, and, lte, isNull, or, sql, inArray } from "drizzle-orm";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { scheduleCampaignCall } from "../orchestration/campaignCaller.js";
import { logger } from "../lib/logger.js";
import { processRetries } from "./retryEngine.js";

let started = false;

/**
 * Global campaign concurrency governor.
 * Tracks how many outbound calls are currently in progress per campaign.
 */
const activeCampaignCalls = new Map<number, number>();

export function getActiveCampaignCalls(campaignId: number): number {
  return activeCampaignCalls.get(campaignId) ?? 0;
}

export function incrementCampaignCalls(campaignId: number): void {
  activeCampaignCalls.set(campaignId, (activeCampaignCalls.get(campaignId) ?? 0) + 1);
}

export function decrementCampaignCalls(campaignId: number): void {
  const n = (activeCampaignCalls.get(campaignId) ?? 0) - 1;
  if (n <= 0) activeCampaignCalls.delete(campaignId);
  else activeCampaignCalls.set(campaignId, n);
}

export function getAllCampaignConcurrency(): Map<number, number> {
  return new Map(activeCampaignCalls);
}

export function startBatchScheduler(): void {
  if (started) return;
  started = true;

  setInterval(() => {
    void pollScheduledBatches();
    void processRetries();
  }, 60_000);

  logger.info({ campaignWebhookBaseUrl: getSelfBaseUrl() }, "Batch scheduler started");
}

async function pollScheduledBatches(): Promise<void> {
  try {
    // Process draft batches whose scheduled start time has arrived (or is null = start immediately)
    const dueDraft = await db.select().from(campaignBatchesTable)
      .where(and(
        eq(campaignBatchesTable.status, "draft"),
        or(
          isNull(campaignBatchesTable.scheduledStartAt),
          lte(campaignBatchesTable.scheduledStartAt, new Date()),
        ),
      ));

    for (const batch of dueDraft) {
      const [campaign] = await db.select().from(campaignsTable)
        .where(eq(campaignsTable.id, batch.campaignId));
      if (!campaign || !campaign.isActive) continue;

      // Mark batch as running
      await db.update(campaignBatchesTable)
        .set({ status: "running" })
        .where(eq(campaignBatchesTable.id, batch.id));

      // Queue up to the concurrency limit
      const limit = campaign.concurrentCallLimit ?? 20;
      const currentlyActive = await countCallingLeads(campaign.id);
      const slots = Math.max(0, limit - currentlyActive);

      if (slots <= 0) {
        logger.info({ batchId: batch.id, campaignId: campaign.id }, "Campaign at concurrency limit — batch queued");
        continue;
      }

      const pending = await db.select().from(campaignLeadsTable)
        .where(and(
          eq(campaignLeadsTable.campaignId, campaign.id),
          sql`${campaignLeadsTable.batchId} = ${batch.id}`,
          eq(campaignLeadsTable.callStatus, "pending"),
        ))
        .limit(slots);

      for (const lead of pending) {
        scheduleCampaignCall(lead, campaign);
      }

      logger.info({ batchId: batch.id, batchName: batch.name, leads: pending.length, slots, limit }, "Scheduled batch auto-started");
    }

    // Also check running batches — continue queueing as calls finish
    const runningBatches = await db.select().from(campaignBatchesTable)
      .where(eq(campaignBatchesTable.status, "running"));

    for (const batch of runningBatches) {
      const [campaign] = await db.select().from(campaignsTable)
        .where(eq(campaignsTable.id, batch.campaignId));
      if (!campaign || !campaign.isActive) continue;

      const limit = campaign.concurrentCallLimit ?? 20;
      const currentlyActive = await countCallingLeads(campaign.id);
      const slots = Math.max(0, limit - currentlyActive);

      if (slots <= 0) continue;

      const pending = await db.select().from(campaignLeadsTable)
        .where(and(
          eq(campaignLeadsTable.campaignId, campaign.id),
          sql`${campaignLeadsTable.batchId} = ${batch.id}`,
          eq(campaignLeadsTable.callStatus, "pending"),
        ))
        .limit(slots);

      for (const lead of pending) {
        scheduleCampaignCall(lead, campaign);
      }

      if (pending.length > 0) {
        logger.info({ batchId: batch.id, campaignId: campaign.id, leads: pending.length, slots }, "Running batch continued");
      }

      // If no more pending leads, mark batch complete
      const remainingPending = await db.select({ count: sql<number>`count(*)` })
        .from(campaignLeadsTable)
        .where(and(
          eq(campaignLeadsTable.batchId, batch.id),
          eq(campaignLeadsTable.callStatus, "pending"),
        ));
      if (remainingPending[0]?.count === 0) {
        await db.update(campaignBatchesTable)
          .set({ status: "completed" })
          .where(eq(campaignBatchesTable.id, batch.id));
        logger.info({ batchId: batch.id }, "Batch completed — all leads processed");
      }
    }
  } catch (err) {
    logger.error({ err }, "Batch scheduler error");
  }
}

async function countCallingLeads(campaignId: number): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)` })
    .from(campaignLeadsTable)
    .where(and(
      eq(campaignLeadsTable.campaignId, campaignId),
      inArray(campaignLeadsTable.callStatus, ["calling", "connected"]),
    ));
  return result[0]?.count ?? 0;
}

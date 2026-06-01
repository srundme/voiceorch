import { db, campaignsTable, campaignBatchesTable, campaignLeadsTable } from "@workspace/db";
import { eq, and, lte, sql } from "drizzle-orm";
import { scheduleCampaignCall } from "../orchestration/campaignCaller.js";
import { logger } from "../lib/logger.js";

let started = false;

export function startBatchScheduler(): void {
  if (started) return;
  started = true;

  setInterval(() => {
    void pollScheduledBatches();
  }, 60_000);

  logger.info("Batch scheduler started");
}

async function pollScheduledBatches(): Promise<void> {
  try {
    // Find draft batches whose scheduled start time has arrived
    const due = await db.select().from(campaignBatchesTable)
      .where(and(
        eq(campaignBatchesTable.status, "draft"),
        lte(campaignBatchesTable.scheduledStartAt, new Date()),
      ));

    for (const batch of due) {
      const [campaign] = await db.select().from(campaignsTable)
        .where(eq(campaignsTable.id, batch.campaignId));
      if (!campaign || !campaign.isActive) continue;

      // Mark batch as running
      await db.update(campaignBatchesTable)
        .set({ status: "running" })
        .where(eq(campaignBatchesTable.id, batch.id));

      // Fire calls for pending leads
      const pending = await db.select().from(campaignLeadsTable)
        .where(and(
          eq(campaignLeadsTable.campaignId, campaign.id),
          sql`${campaignLeadsTable.batchId} = ${batch.id}`,
          eq(campaignLeadsTable.callStatus, "pending"),
        ));

      for (const lead of pending) {
        scheduleCampaignCall(lead, campaign);
      }

      logger.info({ batchId: batch.id, batchName: batch.name, leads: pending.length }, "Scheduled batch auto-started");
    }
  } catch (err) {
    logger.error({ err }, "Batch scheduler error");
  }
}

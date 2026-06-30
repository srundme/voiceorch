/**
 * Retry Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Polls call_retries for due entries and fires the calls.
 * Called from batchScheduler every 60 s.
 */

import { db, callRetriesTable, campaignLeadsTable, campaignsTable, campaignBatchesTable, leadTimelineTable } from "@workspace/db";
import { and, eq, lte } from "drizzle-orm";
import { withDbRetry } from "../orchestration/db-retry.js";
import { scheduleCampaignCall } from "../orchestration/campaignCaller.js";
import { isCampaignDialable } from "./campaign-dialable.js";
import { logger } from "../lib/logger.js";

/**
 * Resolve the effective retry config (Max Attempts / Retry Delay) for a lead.
 *
 * Execution Rules are configured PER BATCH and stored on the `campaign_batches`
 * row. The retry scheduler must honor those batch-level values; it falls back to
 * the campaign-level defaults only when the lead has no batch (or the batch row
 * is missing). This is the single source of truth shared by every retry path
 * (webhook terminal-status handler, campaignCaller catch path, batch-scheduler
 * stuck-call sweep, and the session.ts max-attempts check) so they all resolve
 * identically.
 */
export async function resolveRetryConfig(
  batchId: number | null | undefined,
  campaign: { maxAttempts?: number | null; retryDelayMinutes?: number | null } | null | undefined,
): Promise<{ maxAttempts: number; retryDelayMinutes: number }> {
  let batch: { maxAttempts: number | null; retryDelayMinutes: number | null } | undefined;
  if (batchId != null) {
    [batch] = await db
      .select({
        maxAttempts:       campaignBatchesTable.maxAttempts,
        retryDelayMinutes: campaignBatchesTable.retryDelayMinutes,
      })
      .from(campaignBatchesTable)
      .where(eq(campaignBatchesTable.id, batchId))
      .limit(1);
  }

  return {
    maxAttempts:       batch?.maxAttempts ?? campaign?.maxAttempts ?? 1,
    retryDelayMinutes: batch?.retryDelayMinutes ?? campaign?.retryDelayMinutes ?? 60,
  };
}

export async function processRetries(): Promise<void> {
  try {
    const dueRetries = await withDbRetry("retry-engine-poll", () =>
      db.select().from(callRetriesTable)
        .where(and(
          eq(callRetriesTable.status, "pending"),
          lte(callRetriesTable.scheduledAt, new Date()),
        ))
        .limit(100),
    );

    if (dueRetries.length === 0) return;

    for (const retry of dueRetries) {
      const [lead] = await db.select().from(campaignLeadsTable)
        .where(eq(campaignLeadsTable.id, retry.leadId));

      if (!lead) {
        await db.update(callRetriesTable)
          .set({ status: "cancelled" })
          .where(eq(callRetriesTable.id, retry.id));
        continue;
      }

      const [campaign] = await db.select().from(campaignsTable)
        .where(eq(campaignsTable.id, retry.campaignId));

      if (!campaign || !isCampaignDialable(campaign)) {
        await db.update(callRetriesTable)
          .set({ status: "cancelled" })
          .where(eq(callRetriesTable.id, retry.id));
        continue;
      }

      if (lead.callStatus === "calling" || lead.callStatus === "completed") {
        await db.update(callRetriesTable)
          .set({ status: "cancelled" })
          .where(eq(callRetriesTable.id, retry.id));
        continue;
      }

      await db.update(callRetriesTable)
        .set({ status: "fired" })
        .where(eq(callRetriesTable.id, retry.id));

      await db.update(campaignLeadsTable)
        .set({ callStatus: "pending", notes: `Auto-retry #${retry.attemptNumber}` })
        .where(eq(campaignLeadsTable.id, lead.id));

      await db.insert(leadTimelineTable).values({
        leadId:     lead.id,
        campaignId: retry.campaignId,
        eventType:  "retry_fired",
        data:       { attemptNumber: retry.attemptNumber, reason: retry.reason },
      });

      const [freshLead] = await db.select().from(campaignLeadsTable)
        .where(eq(campaignLeadsTable.id, lead.id));

      scheduleCampaignCall(freshLead!, campaign);
      logger.info({ leadId: lead.id, attempt: retry.attemptNumber, campaignId: retry.campaignId }, "Retry fired");
    }
  } catch (err) {
    logger.error({ err }, "Retry engine error");
  }
}

/**
 * Schedule an automatic retry for a lead.
 * Respects campaign.maxAttempts and campaign.retryDelayMinutes.
 */
export async function scheduleRetry(opts: {
  leadId: number;
  campaignId: number;
  currentAttempts: number;
  maxAttempts: number;
  retryDelayMinutes: number;
  reason: string;
}): Promise<boolean> {
  const { leadId, campaignId, currentAttempts, maxAttempts, retryDelayMinutes, reason } = opts;

  if (currentAttempts >= maxAttempts) {
    return false;
  }

  const nextAttempt = currentAttempts + 1;
  const scheduledAt = new Date(Date.now() + retryDelayMinutes * 60 * 1000);

  await db.insert(callRetriesTable).values({
    leadId,
    campaignId,
    attemptNumber: nextAttempt,
    scheduledAt,
    status:        "pending",
    reason,
  });

  await db.insert(leadTimelineTable).values({
    leadId,
    campaignId,
    eventType: "retry_scheduled",
    data:      { attemptNumber: nextAttempt, scheduledAt: scheduledAt.toISOString(), reason, retryDelayMinutes },
  });

  logger.info({ leadId, campaignId, nextAttempt, scheduledAt }, "Retry scheduled");
  return true;
}

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

      // Authoritative max-attempts guard at fire time. Regardless of how this
      // retry row was created (or how many duplicate rows slipped through), never
      // fire a retry once the lead's attempts already meet the configured maximum.
      // Resolves batch-level Execution Rules, falling back to campaign defaults.
      const { maxAttempts } = await resolveRetryConfig(lead.batchId, campaign);
      if ((lead.callAttempts ?? 0) >= maxAttempts) {
        await db.update(callRetriesTable)
          .set({ status: "cancelled" })
          .where(eq(callRetriesTable.id, retry.id));
        logger.info(
          { leadId: lead.id, campaignId: retry.campaignId, callAttempts: lead.callAttempts ?? 0, maxAttempts },
          "Retry cancelled — max attempts already reached",
        );
        continue;
      }

      await db.update(callRetriesTable)
        .set({ status: "fired" })
        .where(eq(callRetriesTable.id, retry.id));

      await db.update(campaignLeadsTable)
        .set({ callStatus: "pending", notes: `Auto-retry #${retry.attemptNumber}` })
        .where(eq(campaignLeadsTable.id, lead.id));

      // If this lead belongs to a completed batch, reopen it so the scheduler
      // picks it up again. Without this a retry on a completed batch would flip
      // the lead to pending but the 60 s poll would skip it (only queries
      // status = 'running') and the lead would sit pending forever.
      if (lead.batchId) {
        await db.update(campaignBatchesTable)
          .set({ status: "running" })
          .where(and(
            eq(campaignBatchesTable.id, lead.batchId),
            eq(campaignBatchesTable.status, "completed"),
          ));
      }

      await db.insert(leadTimelineTable).values({
        leadId:     lead.id,
        campaignId: retry.campaignId,
        eventType:  "retry_fired",
        data:       { attemptNumber: retry.attemptNumber, reason: retry.reason },
      });

      const [freshLead] = await db.select().from(campaignLeadsTable)
        .where(eq(campaignLeadsTable.id, lead.id));

      scheduleCampaignCall(freshLead!, campaign);
      logger.info({ leadId: lead.id, attempt: retry.attemptNumber, campaignId: retry.campaignId, batchId: lead.batchId ?? null }, "Retry fired");
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

  // Use a fresh, authoritative attempts value so every caller (webhook terminal
  // handler, campaignCaller catch path, stuck-calling sweep) resolves the guard
  // identically even if the count changed since each read its own snapshot.
  const [leadRow] = await db
    .select({ callAttempts: campaignLeadsTable.callAttempts })
    .from(campaignLeadsTable)
    .where(eq(campaignLeadsTable.id, leadId))
    .limit(1);
  const effectiveAttempts = Math.max(currentAttempts, leadRow?.callAttempts ?? 0);

  if (effectiveAttempts >= maxAttempts) {
    return false;
  }

  // Idempotent per lead: if a pending retry already exists for this lead, do not
  // insert another. The three independent failure paths above can each fire for
  // the same call; without this guard each would create a duplicate call_retries
  // row and the retry engine would over-dial past the configured maximum.
  const [existing] = await db
    .select({ id: callRetriesTable.id })
    .from(callRetriesTable)
    .where(and(
      eq(callRetriesTable.leadId, leadId),
      eq(callRetriesTable.status, "pending"),
    ))
    .limit(1);
  if (existing) {
    logger.info({ leadId, campaignId }, "Retry already pending — skipping duplicate schedule");
    return false;
  }

  const nextAttempt = effectiveAttempts + 1;
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

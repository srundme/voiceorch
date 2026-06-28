import { db, campaignsTable, campaignBatchesTable, campaignLeadsTable, leadTimelineTable, callsTable } from "@workspace/db";
import { eq, and, lte, isNull, or, sql, inArray, lt } from "drizzle-orm";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { scheduleCampaignCall } from "../orchestration/campaignCaller.js";
import { scheduleRetry, processRetries } from "./retryEngine.js";
import { logger } from "../lib/logger.js";

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

/**
 * How long a lead may remain in "calling" without a terminal webhook before the
 * scheduler treats it as stuck and fails it. Most telephony providers deliver
 * the hangup within seconds; 15 minutes is a very conservative ceiling.
 * Overridable via the STUCK_CALLING_TIMEOUT_MS env var.
 */
const STUCK_CALLING_TIMEOUT_MS =
  parseInt(process.env["STUCK_CALLING_TIMEOUT_MS"] ?? "0", 10) || 15 * 60 * 1000;

export function startBatchScheduler(): void {
  if (started) return;
  started = true;

  setInterval(() => {
    void pollScheduledBatches();
    void processRetries();
    void sweepStuckCallingLeads();
    void sweepStuckInProgressCalls();
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

/**
 * Safety sweep — runs every 60 s alongside the normal batch poll.
 *
 * Finds campaign leads that have been stuck in "calling" status for longer than
 * STUCK_CALLING_TIMEOUT_MS without receiving a terminal webhook (busy / failed /
 * no-answer).  This happens when a provider never delivers the hangup callback
 * (e.g. Plivo before the status URL was wired, or a network split).
 *
 * Stuck leads are transitioned to "failed" and offered for retry so they do
 * not permanently block the concurrency counter and are eventually re-dialed.
 */
async function sweepStuckCallingLeads(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STUCK_CALLING_TIMEOUT_MS);

    const stuck = await db.select().from(campaignLeadsTable)
      .where(and(
        eq(campaignLeadsTable.callStatus, "calling"),
        lt(campaignLeadsTable.lastAttemptAt, cutoff),
      ))
      .limit(200);

    if (stuck.length === 0) return;

    for (const lead of stuck) {
      try {
        await db.update(campaignLeadsTable)
          .set({ callStatus: "failed", notes: "Stuck in calling — no terminal webhook received; auto-failed by scheduler" })
          .where(and(
            eq(campaignLeadsTable.id, lead.id),
            eq(campaignLeadsTable.callStatus, "calling"),
          ));

        await db.insert(leadTimelineTable).values({
          leadId:     lead.id,
          campaignId: lead.campaignId,
          eventType:  "call_ended",
          data:       { callStatus: "failed", reason: "stuck_calling_sweep", timeoutMs: STUCK_CALLING_TIMEOUT_MS },
        });

        const [campaign] = await db.select().from(campaignsTable)
          .where(eq(campaignsTable.id, lead.campaignId));

        if (campaign) {
          await scheduleRetry({
            leadId:            lead.id,
            campaignId:        lead.campaignId,
            currentAttempts:   lead.callAttempts ?? 0,
            maxAttempts:       campaign.maxAttempts ?? 1,
            retryDelayMinutes: campaign.retryDelayMinutes ?? 60,
            reason:            "stuck_calling",
          });
        }

        logger.warn({ leadId: lead.id, campaignId: lead.campaignId, lastAttemptAt: lead.lastAttemptAt }, "Stuck calling lead auto-failed by sweep");
      } catch (leadErr) {
        logger.error({ err: leadErr, leadId: lead.id }, "sweepStuckCallingLeads: error processing lead");
      }
    }

    logger.info({ count: stuck.length }, "sweepStuckCallingLeads: processed stuck leads");
  } catch (err) {
    logger.error({ err }, "sweepStuckCallingLeads error");
  }
}

/**
 * Safety sweep — runs every 60 s alongside the normal batch poll.
 *
 * Finds rows in `calls` that have been stuck in "in_progress" status for
 * longer than STUCK_CALL_TIMEOUT_MS without their endSession() completing.
 * This happens when recording.finalize() hangs (e.g. DB pool exhaustion
 * when multiple calls end simultaneously, all racing to insert WAV blobs),
 * leaving the db.update(status:"completed") unreachable.
 *
 * The 60-second timeout added to recording.finalize() in session.ts is the
 * primary fix; this sweep is a secondary safety net that closes any calls
 * that slipped through despite the timeout.
 */
const STUCK_CALL_TIMEOUT_MS =
  parseInt(process.env["STUCK_CALL_TIMEOUT_MS"] ?? "0", 10) || 30 * 60 * 1000;

async function sweepStuckInProgressCalls(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STUCK_CALL_TIMEOUT_MS);

    const stuck = await db
      .select({ id: callsTable.id, createdAt: callsTable.createdAt })
      .from(callsTable)
      .where(and(
        eq(callsTable.status, "in_progress"),
        lt(callsTable.createdAt, cutoff),
      ))
      .limit(50);

    if (stuck.length === 0) return;

    for (const call of stuck) {
      try {
        const durationSeconds = Math.floor((Date.now() - call.createdAt.getTime()) / 1000);
        await db
          .update(callsTable)
          .set({
            status: "completed",
            endedAt: new Date(),
            durationSeconds,
          })
          .where(and(
            eq(callsTable.id, call.id),
            eq(callsTable.status, "in_progress"),
          ));
        logger.warn({ callId: call.id, durationSeconds }, "Stuck in-progress call auto-closed by sweep");
      } catch (callErr) {
        logger.error({ err: callErr, callId: call.id }, "sweepStuckInProgressCalls: error processing call");
      }
    }

    logger.info({ count: stuck.length }, "sweepStuckInProgressCalls: processed stuck calls");
  } catch (err) {
    logger.error({ err }, "sweepStuckInProgressCalls error");
  }
}

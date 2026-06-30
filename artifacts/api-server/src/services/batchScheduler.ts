import { db, campaignsTable, campaignBatchesTable, campaignLeadsTable, leadTimelineTable, callsTable } from "@workspace/db";
import { eq, and, lte, isNull, or, sql, inArray, lt } from "drizzle-orm";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { scheduleCampaignCall } from "../orchestration/campaignCaller.js";
import { scheduleRetry, processRetries, resolveRetryConfig } from "./retryEngine.js";
import { isCampaignDialable } from "./campaign-dialable.js";
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
      if (!campaign || !isCampaignDialable(campaign)) continue;

      // Mark batch as running
      await db.update(campaignBatchesTable)
        .set({ status: "running" })
        .where(eq(campaignBatchesTable.id, batch.id));

      // Fire the first wave up to the concurrency limit (atomic claim, shared
      // with the event-driven refill so the limit is respected the same way).
      await refillCampaignConcurrency(campaign.id);

      logger.info({ batchId: batch.id, batchName: batch.name }, "Scheduled batch auto-started");
    }

    // Also check running batches — backstop reconciliation: top each campaign
    // back up to its limit in case an event-driven refill was missed, and mark
    // batches complete once all their leads are processed.
    const runningBatches = await db.select().from(campaignBatchesTable)
      .where(eq(campaignBatchesTable.status, "running"));

    for (const batch of runningBatches) {
      const [campaign] = await db.select().from(campaignsTable)
        .where(eq(campaignsTable.id, batch.campaignId));
      if (!campaign || !isCampaignDialable(campaign)) continue;

      await refillCampaignConcurrency(campaign.id);

      // Mark batch complete when no leads are pending OR still actively calling.
      // Note: PostgreSQL returns count(*) as a string — use Number() to coerce.
      const [pendingRow] = await db.select({ count: sql<string>`count(*)` })
        .from(campaignLeadsTable)
        .where(and(
          eq(campaignLeadsTable.batchId, batch.id),
          eq(campaignLeadsTable.callStatus, "pending"),
        ));
      const [activeRow] = await db.select({ count: sql<string>`count(*)` })
        .from(campaignLeadsTable)
        .where(and(
          eq(campaignLeadsTable.batchId, batch.id),
          inArray(campaignLeadsTable.callStatus, ["calling", "connected"]),
        ));
      const pendingCount = Number(pendingRow?.count ?? 0);
      const activeCount  = Number(activeRow?.count  ?? 0);
      if (pendingCount === 0 && activeCount === 0) {
        await db.update(campaignBatchesTable)
          .set({ status: "completed" })
          .where(eq(campaignBatchesTable.id, batch.id));
        logger.info({ batchId: batch.id, pendingCount, activeCount }, "Batch completed — all leads processed");
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
 * Event-driven rolling refill.
 * ──────────────────────────────────────────────────────────────────────────
 * Tops a campaign back up to its configured `concurrentCallLimit` by claiming
 * and dialing the next pending lead(s) the instant a slot frees up — without
 * waiting for the 60 s backstop poll. This is what makes concurrency *rolling*:
 * every terminal call-end path (non-connected webhook, connected/completed,
 * transfer, callback-scheduled) calls this so the campaign stays topped up.
 *
 * Uses the SAME atomic pre-claim as `fireStartBatch` (campaign-batches.ts) so
 * the `calling`/`connected` count remains the single source of truth and the
 * same lead is never double-dialed. Refills are serialized per-campaign within
 * the process (`refillInFlight`) so two simultaneous call-ends can't both
 * compute the same free-slot count and over-claim past the limit; if a refill
 * is requested while one is already running for that campaign, it re-runs once
 * more afterwards so no freed slot is missed.
 */
const refillInFlight = new Set<number>();
const refillRerun = new Set<number>();

export async function refillCampaignConcurrency(campaignId: number): Promise<void> {
  if (refillInFlight.has(campaignId)) {
    refillRerun.add(campaignId);
    return;
  }
  refillInFlight.add(campaignId);
  try {
    await doRefillCampaignConcurrency(campaignId);
  } finally {
    refillInFlight.delete(campaignId);
    if (refillRerun.delete(campaignId)) {
      void refillCampaignConcurrency(campaignId);
    }
  }
}

async function doRefillCampaignConcurrency(campaignId: number): Promise<void> {
  try {
    const [campaign] = await db.select().from(campaignsTable)
      .where(eq(campaignsTable.id, campaignId));
    if (!campaign || !isCampaignDialable(campaign)) {
      logger.debug({ campaignId, status: campaign?.status ?? null }, "Rolling refill skipped — campaign not dialable");
      return;
    }

    const limit = campaign.concurrentCallLimit ?? 20;
    const currentlyActive = await countCallingLeads(campaign.id);
    let slots = Math.max(0, limit - currentlyActive);
    if (slots <= 0) return;

    // Oldest running batches first so leads dial in batch order.
    const runningBatches = await db.select().from(campaignBatchesTable)
      .where(and(
        eq(campaignBatchesTable.campaignId, campaign.id),
        eq(campaignBatchesTable.status, "running"),
      ))
      .orderBy(campaignBatchesTable.id);

    for (const batch of runningBatches) {
      if (slots <= 0) break;

      // Atomic pre-claim — identical guard to fireStartBatch. The trailing
      // `AND call_status = 'pending'` means a concurrent claim on the same rows
      // sees the committed 'calling' status and skips them, so no lead is ever
      // double-dialed even if the poll and an event-driven refill race.
      // NB: only call_status is written here. last_attempt_at is set by
      // fireCampaignCall at the moment a real dial is placed, so "Last Activity"
      // reflects an actual outbound attempt and never a mere pre-claim.
      const claimed = await db.execute<{ id: number }>(sql`
        UPDATE campaign_leads
        SET call_status = 'calling'
        WHERE id IN (
          SELECT id FROM campaign_leads
          WHERE campaign_id = ${campaign.id}
            AND batch_id = ${batch.id}
            AND call_status = 'pending'
            AND NOT EXISTS (
              SELECT 1 FROM call_retries cr
              WHERE cr.lead_id = campaign_leads.id
                AND cr.status = 'pending'
                AND cr.scheduled_at > now()
            )
          ORDER BY id
          LIMIT ${slots}
        )
        AND call_status = 'pending'
        RETURNING id
      `);

      const claimedIds = claimed.rows.map(r => r.id);
      if (claimedIds.length === 0) continue;

      const claimedLeads = await db.select().from(campaignLeadsTable)
        .where(inArray(campaignLeadsTable.id, claimedIds));

      for (const lead of claimedLeads) {
        scheduleCampaignCall(lead, campaign);
      }

      slots -= claimedIds.length;
      logger.info(
        { campaignId: campaign.id, batchId: batch.id, dialed: claimedIds.length, limit, currentlyActive },
        "Rolling refill: dialed next pending leads",
      );
    }
  } catch (err) {
    logger.error({ err, campaignId }, "refillCampaignConcurrency error");
  }
}

/**
 * Resolve a campaign lead's campaign and refill its concurrency. Convenience
 * wrapper for call-end paths that only have the leadId in hand (e.g. session.ts).
 */
export async function refillCampaignForLead(leadId: number): Promise<void> {
  try {
    const [lead] = await db.select({ campaignId: campaignLeadsTable.campaignId })
      .from(campaignLeadsTable)
      .where(eq(campaignLeadsTable.id, leadId));
    if (lead) await refillCampaignConcurrency(lead.campaignId);
  } catch (err) {
    logger.error({ err, leadId }, "refillCampaignForLead error");
  }
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

    const affectedCampaigns = new Set<number>();

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
          const { maxAttempts, retryDelayMinutes } = await resolveRetryConfig(lead.batchId, campaign);
          await scheduleRetry({
            leadId:            lead.id,
            campaignId:        lead.campaignId,
            currentAttempts:   lead.callAttempts ?? 0,
            maxAttempts,
            retryDelayMinutes,
            reason:            "stuck_calling",
          });
        }

        affectedCampaigns.add(lead.campaignId);
        logger.warn({ leadId: lead.id, campaignId: lead.campaignId, lastAttemptAt: lead.lastAttemptAt }, "Stuck calling lead auto-failed by sweep");
      } catch (leadErr) {
        logger.error({ err: leadErr, leadId: lead.id }, "sweepStuckCallingLeads: error processing lead");
      }
    }

    // Freed the stuck slots — immediately top each affected campaign back up so
    // rolling concurrency resumes now instead of waiting for the next poll tick.
    for (const campaignId of affectedCampaigns) {
      await refillCampaignConcurrency(campaignId);
    }

    logger.info({ count: stuck.length, campaigns: affectedCampaigns.size }, "sweepStuckCallingLeads: processed stuck leads");
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

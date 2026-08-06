import { db, campaignsTable, campaignBatchesTable, campaignLeadsTable, leadTimelineTable, callsTable, callRetriesTable } from "@workspace/db";
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

import { startMeetingBotAutoDispatcher } from "./meet-auto-dispatch.js";

export function startBatchScheduler(): void {
  if (started) return;
  started = true;

  setInterval(() => {
    void pollScheduledBatches();
    void processRetries();
    void sweepStuckCallingLeads();
    void sweepStuckInProgressCalls();
  }, 60_000);

  startMeetingBotAutoDispatcher();

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
    //
    // IMPORTANT: refill stays behind the dialability gate (never dial a paused /
    // off-hours campaign), but completion evaluation is dialability-INDEPENDENT —
    // a paused or off-hours campaign whose leads are all done must still have its
    // batch flipped to "completed" so the UI stops showing a stuck "Running".
    const runningBatches = await db.select().from(campaignBatchesTable)
      .where(eq(campaignBatchesTable.status, "running"));

    const campaignIdsSeen = new Set<number>();
    for (const batch of runningBatches) {
      const [campaign] = await db.select().from(campaignsTable)
        .where(eq(campaignsTable.id, batch.campaignId));
      if (!campaign) continue;

      if (isCampaignDialable(campaign)) {
        await refillCampaignConcurrency(campaign.id);
      }

      await evaluateBatchCompletion(batch.id);
      campaignIdsSeen.add(campaign.id);
    }

    // After every running batch has settled, reconcile each seen campaign's own
    // status so it auto-transitions to "completed" in lockstep with its batches.
    for (const campaignId of campaignIdsSeen) {
      await evaluateCampaignCompletion(campaignId);
    }
  } catch (err) {
    logger.error({ err }, "Batch scheduler error");
  }
}

// Batch statuses that still represent outstanding (or resumable) work.
// Anything NOT in this set (completed / stopped / cancelled) is terminal.
const NON_TERMINAL_BATCH_STATUSES = ["draft", "running", "paused"];

/**
 * Decide whether a running batch is finished and flip it to "completed".
 *
 * A batch is complete only when it has genuinely nothing left to do:
 *   - zero leads in "pending"
 *   - zero leads in "calling" / "connected" (nothing in flight)
 *   - zero *pending* call_retries still scheduled for any of its leads
 *
 * The final UPDATE is guarded on `status = 'running'` so it is a no-op (and
 * never fights a concurrent reopen) if the batch was already resumed. This is
 * intentionally dialability-independent: completion must happen even while the
 * campaign is paused or outside business hours.
 *
 * Returns true iff this call transitioned the batch to "completed".
 */
export async function evaluateBatchCompletion(batchId: number): Promise<boolean> {
  try {
    const [batch] = await db.select({
      name: campaignBatchesTable.name,
      leadSource: campaignBatchesTable.leadSource,
    }).from(campaignBatchesTable).where(eq(campaignBatchesTable.id, batchId)).limit(1);
    // Call-plan dial queue stays open like a continuous campaign source.
    if (batch?.name === "__call_plan_queue" || batch?.leadSource === "workflow") {
      return false;
    }

    // PostgreSQL returns count(*) as a string — coerce with Number().
    const [pendingRow] = await db.select({ count: sql<string>`count(*)` })
      .from(campaignLeadsTable)
      .where(and(
        eq(campaignLeadsTable.batchId, batchId),
        inArray(campaignLeadsTable.callStatus, ["pending", "queued"]),
      ));
    const [activeRow] = await db.select({ count: sql<string>`count(*)` })
      .from(campaignLeadsTable)
      .where(and(
        eq(campaignLeadsTable.batchId, batchId),
        inArray(campaignLeadsTable.callStatus, ["calling", "connected"]),
      ));
    const [retryRow] = await db.select({ count: sql<string>`count(*)` })
      .from(callRetriesTable)
      .where(and(
        eq(callRetriesTable.status, "pending"),
        sql`EXISTS (
          SELECT 1 FROM campaign_leads cl
          WHERE cl.id = ${callRetriesTable.leadId}
            AND cl.batch_id = ${batchId}
        )`,
      ));

    const pendingCount = Number(pendingRow?.count ?? 0);
    const activeCount  = Number(activeRow?.count  ?? 0);
    const retryCount   = Number(retryRow?.count   ?? 0);
    if (pendingCount !== 0 || activeCount !== 0 || retryCount !== 0) return false;

    const updated = await db.update(campaignBatchesTable)
      .set({ status: "completed" })
      .where(and(
        eq(campaignBatchesTable.id, batchId),
        eq(campaignBatchesTable.status, "running"),
      ))
      .returning({ id: campaignBatchesTable.id });

    if (updated.length > 0) {
      logger.info({ batchId, pendingCount, activeCount, retryCount }, "Batch completed — all leads processed & retries exhausted");
      return true;
    }
    return false;
  } catch (err) {
    logger.error({ err, batchId }, "evaluateBatchCompletion error");
    return false;
  }
}

/**
 * Auto-transition a campaign to "completed" in lockstep with its batches.
 *
 * Only fires for campaigns currently in "active" or "draft" (a batch can run
 * while the campaign row is still "draft"). A user-chosen "paused"/"cancelled"
 * and an already-"completed" campaign are left untouched.
 *
 * Completion requires that ALL of the following hold campaign-wide:
 *   - no non-terminal batches (draft / running / paused)
 *   - no leads still active (pending / calling / connected) — this also covers
 *     instant / batchless campaigns whose leads have batch_id = null
 *   - no pending call_retries
 *   - at least one lead ever existed (never "complete" an empty campaign)
 *
 * The final UPDATE is status-guarded so it never races a concurrent reopen.
 */
export async function evaluateCampaignCompletion(campaignId: number): Promise<void> {
  try {
    const [campaign] = await db.select().from(campaignsTable)
      .where(eq(campaignsTable.id, campaignId));
    if (!campaign) return;
    // Continuous lead sources (webhook, meta_ads, crm, workflow/call-plans) never auto-complete
    const continuousSources = new Set(["webhook", "meta_ads", "crm", "workflow"]);
    if (continuousSources.has(campaign.leadSource ?? "")) return;
    if (campaign.status !== "active" && campaign.status !== "draft") return;

    const [openBatchRow] = await db.select({ count: sql<string>`count(*)` })
      .from(campaignBatchesTable)
      .where(and(
        eq(campaignBatchesTable.campaignId, campaignId),
        inArray(campaignBatchesTable.status, NON_TERMINAL_BATCH_STATUSES),
      ));
    if (Number(openBatchRow?.count ?? 0) > 0) return;

    const [activeLeadRow] = await db.select({ count: sql<string>`count(*)` })
      .from(campaignLeadsTable)
      .where(and(
        eq(campaignLeadsTable.campaignId, campaignId),
        inArray(campaignLeadsTable.callStatus, ["pending", "queued", "calling", "connected"]),
      ));
    if (Number(activeLeadRow?.count ?? 0) > 0) return;

    const [retryRow] = await db.select({ count: sql<string>`count(*)` })
      .from(callRetriesTable)
      .where(and(
        eq(callRetriesTable.campaignId, campaignId),
        eq(callRetriesTable.status, "pending"),
      ));
    if (Number(retryRow?.count ?? 0) > 0) return;

    // Never auto-complete a campaign that never had any work.
    const [totalLeadRow] = await db.select({ count: sql<string>`count(*)` })
      .from(campaignLeadsTable)
      .where(eq(campaignLeadsTable.campaignId, campaignId));
    if (Number(totalLeadRow?.count ?? 0) === 0) return;

    const updated = await db.update(campaignsTable)
      .set({ status: "completed" })
      .where(and(
        eq(campaignsTable.id, campaignId),
        inArray(campaignsTable.status, ["active", "draft"]),
      ))
      .returning({ id: campaignsTable.id });

    if (updated.length > 0) {
      logger.info({ campaignId }, "Campaign auto-completed — all batches terminal & no work remaining");
    }
  } catch (err) {
    logger.error({ err, campaignId }, "evaluateCampaignCompletion error");
  }
}

/**
 * Evaluate every running batch of a campaign for completion, then reconcile the
 * campaign's own status. Call this from any terminal call-end path (after the
 * refill) so batch/campaign status tracks real execution state immediately,
 * without waiting for the 60 s backstop poll.
 */
export async function reconcileCampaignBatches(campaignId: number): Promise<void> {
  try {
    const runningBatches = await db.select({ id: campaignBatchesTable.id })
      .from(campaignBatchesTable)
      .where(and(
        eq(campaignBatchesTable.campaignId, campaignId),
        eq(campaignBatchesTable.status, "running"),
      ));
    for (const b of runningBatches) {
      await evaluateBatchCompletion(b.id);
    }
    await evaluateCampaignCompletion(campaignId);
  } catch (err) {
    logger.error({ err, campaignId }, "reconcileCampaignBatches error");
  }
}

/**
 * Re-open a campaign that the scheduler previously auto-completed, returning it
 * to a dialable "active" status when work re-enters (a batch is started, leads
 * are redialed, or a retry fires). Guarded on `status = 'completed'` so it only
 * ever reopens an auto-completed campaign — a user-chosen "paused"/"cancelled"
 * campaign is never touched.
 */
export async function reopenCampaignIfCompleted(campaignId: number): Promise<void> {
  try {
    await db.update(campaignsTable)
      .set({ status: "active" })
      .where(and(
        eq(campaignsTable.id, campaignId),
        eq(campaignsTable.status, "completed"),
      ));
  } catch (err) {
    logger.error({ err, campaignId }, "reopenCampaignIfCompleted error");
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

    const isWorkflow = campaign.leadSource === "workflow";
    let limit = campaign.concurrentCallLimit ?? 20;
    let currentlyActive = await countCallingLeads(campaign.id);

    // Call plans share the account concurrentLimit across all workflow campaigns.
    if (isWorkflow) {
      const {
        getUserConcurrentLimit,
        countActiveWorkflowCallsForUser,
      } = await import("./workflow-dial-queue.js");
      limit = await getUserConcurrentLimit(campaign.userId);
      currentlyActive = await countActiveWorkflowCallsForUser(campaign.userId);
    }

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

      // Atomic pre-claim — identical guard to fireStartBatch.
      // Workflow (call-plan) leads also require a waiting_call run on an active
      // journey (or no journey = test/hook), so Pause stops further dials.
      const claimed = isWorkflow
        ? await db.execute<{ id: number }>(sql`
            UPDATE campaign_leads
            SET call_status = 'calling'
            WHERE id IN (
              SELECT cl.id FROM campaign_leads cl
              JOIN workflow_runs wr ON wr.lead_id = cl.id AND wr.status = 'waiting_call'
              LEFT JOIN journeys j ON j.workflow_id = wr.workflow_id
              WHERE cl.campaign_id = ${campaign.id}
                AND cl.batch_id = ${batch.id}
                AND cl.call_status IN ('pending', 'queued')
                AND (j.id IS NULL OR j.status = 'active')
                AND NOT EXISTS (
                  SELECT 1 FROM call_retries cr
                  WHERE cr.lead_id = cl.id
                    AND cr.status = 'pending'
                    AND cr.scheduled_at > now()
                )
              ORDER BY cl.call_status, cl.id
              LIMIT ${slots}
            )
            AND call_status IN ('pending', 'queued')
            RETURNING id
          `)
        : await db.execute<{ id: number }>(sql`
            UPDATE campaign_leads
            SET call_status = 'calling'
            WHERE id IN (
              SELECT id FROM campaign_leads
              WHERE campaign_id = ${campaign.id}
                AND batch_id = ${batch.id}
                AND call_status IN ('pending', 'queued')
                AND NOT EXISTS (
                  SELECT 1 FROM call_retries cr
                  WHERE cr.lead_id = campaign_leads.id
                    AND cr.status = 'pending'
                    AND cr.scheduled_at > now()
                )
              ORDER BY call_status, id
              LIMIT ${slots}
            )
            AND call_status IN ('pending', 'queued')
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
        { campaignId: campaign.id, batchId: batch.id, dialed: claimedIds.length, limit, currentlyActive, isWorkflow },
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
    const { refillWorkflowDialSlotsForLead } = await import("./workflow-dial-queue.js");
    if (await refillWorkflowDialSlotsForLead(leadId)) return;

    const [lead] = await db.select({ campaignId: campaignLeadsTable.campaignId })
      .from(campaignLeadsTable)
      .where(eq(campaignLeadsTable.id, leadId));
    if (lead) {
      await refillCampaignConcurrency(lead.campaignId);
      // Terminal call-end: reconcile so a now-finished batch/campaign flips to
      // "completed" immediately instead of waiting for the backstop poll.
      await reconcileCampaignBatches(lead.campaignId);
    }
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

    // Cover both in-flight states. A lead can hang in "connected" too (e.g. the
    // media stream drops without a terminal hangup webhook), and a stuck
    // "connected" lead blocks the concurrency counter AND keeps its batch from
    // ever completing. Both are swept the same way.
    const stuck = await db.select().from(campaignLeadsTable)
      .where(and(
        inArray(campaignLeadsTable.callStatus, ["calling", "connected"]),
        lt(campaignLeadsTable.lastAttemptAt, cutoff),
      ))
      .limit(200);

    if (stuck.length === 0) return;

    const affectedCampaigns = new Set<number>();

    for (const lead of stuck) {
      try {
        // Guard the update on the lead's OWN observed status so a terminal
        // webhook that lands between the SELECT and this UPDATE wins the race.
        await db.update(campaignLeadsTable)
          .set({ callStatus: "failed", notes: `Stuck in ${lead.callStatus} — no terminal webhook received; auto-failed by scheduler` })
          .where(and(
            eq(campaignLeadsTable.id, lead.id),
            eq(campaignLeadsTable.callStatus, lead.callStatus),
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
    // rolling concurrency resumes now instead of waiting for the next poll tick,
    // then reconcile in case failing the stuck lead was the last outstanding work.
    for (const campaignId of affectedCampaigns) {
      await refillCampaignConcurrency(campaignId);
      await reconcileCampaignBatches(campaignId);
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
        inArray(callsTable.status, ["ringing", "in_progress"]),
        lt(callsTable.createdAt, cutoff),
      ))
      .limit(50);

    if (stuck.length === 0) return;

    // A stuck call never received a proper hangup/teardown, so we never learned
    // its real connected duration. Marking it "completed" with a fabricated
    // (timeout-length) duration inflated aggregate minutes and produced fake
    // "30m 0s" calls in the UI. Instead mark it "failed" with duration 0 and a
    // reason, so it is excluded from completed-call minute analytics and is
    // clearly identifiable as an aborted/orphaned call rather than a real one.
    for (const call of stuck) {
      try {
        await db
          .update(callsTable)
          .set({
            status: "failed",
            endedAt: new Date(),
            durationSeconds: 0,
            errorMessage:
              "Auto-closed: call stuck in progress beyond timeout (no hangup or teardown received)",
          })
          .where(and(
            eq(callsTable.id, call.id),
            inArray(callsTable.status, ["ringing", "in_progress"]),
          ));
        logger.warn({ callId: call.id }, "Stuck in-progress call auto-closed by sweep (marked failed)");
      } catch (callErr) {
        logger.error({ err: callErr, callId: call.id }, "sweepStuckInProgressCalls: error processing call");
      }
    }

    logger.info({ count: stuck.length }, "sweepStuckInProgressCalls: processed stuck calls");
  } catch (err) {
    logger.error({ err }, "sweepStuckInProgressCalls error");
  }
}

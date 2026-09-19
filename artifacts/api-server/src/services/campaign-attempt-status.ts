import { eq } from "drizzle-orm";
import { db, campaignLeadsTable, callExecutionsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { scheduleRetryResult } from "./retryEngine.js";
import {
  assertV2AnsweredNotFailed,
  campaignLeadWritePatch,
  finalizeV2Park,
  planV2AnsweredHangup,
  type CampaignAttemptStatus,
  type ClassifyCampaignCallEndResult,
} from "./campaign-lead-state-v2.js";

/**
 * Flip answered_ever to true. The SQL assignment is only `true` — there is no
 * code path here that can write false.
 */
export async function markLeadAnsweredEver(leadId: number): Promise<void> {
  await db
    .update(campaignLeadsTable)
    .set(campaignLeadWritePatch({ answeredEver: true }))
    .where(eq(campaignLeadsTable.id, leadId));
}

/** Attempt-level technical status. Never writes call_status or answered_ever. */
export async function recordLastAttemptStatus(
  leadId: number,
  status: CampaignAttemptStatus | string,
): Promise<void> {
  await db
    .update(campaignLeadsTable)
    .set({ lastAttemptStatus: status })
    .where(eq(campaignLeadsTable.id, leadId));
}

export async function recordCallExecutionOutcome(
  callId: number,
  outcome: CampaignAttemptStatus | string,
): Promise<void> {
  await db
    .update(callExecutionsTable)
    .set({ outcome })
    .where(eq(callExecutionsTable.callId, callId));
}

/**
 * V2 answered hangup: schedule retry (if wanted) BEFORE parking pending.
 *
 * Fallback when retry insert fails or attempts are exhausted: `completed`.
 * Never parks `pending` without a retry row, and never writes lead `failed`.
 */
export async function applyV2AnsweredHangup(opts: {
  leadId: number;
  campaignId: number;
  callId: number | null;
  currentAttempts: number;
  maxAttempts: number;
  retryDelayMinutes: number;
  classification: ClassifyCampaignCallEndResult;
}): Promise<{
  finalCallStatus: string;
  lastAttemptStatus: CampaignAttemptStatus;
  retryScheduled: boolean;
  retryId: number | null;
  retryReason: string | null;
}> {
  const plan = planV2AnsweredHangup({
    answeredEver: true,
    classification: opts.classification,
  });

  let retryOk = false;
  let retryId: number | null = null;
  if (plan.wantsRetry) {
    try {
      const result = await scheduleRetryResult({
        leadId: opts.leadId,
        campaignId: opts.campaignId,
        currentAttempts: opts.currentAttempts,
        maxAttempts: opts.maxAttempts,
        retryDelayMinutes: opts.retryDelayMinutes,
        reason: plan.retryReason ?? "dropped",
      });
      retryOk = result.scheduled || result.alreadyPending;
      retryId = result.retryId;
    } catch (err) {
      logger.error(
        {
          event: "retry_schedule_failed_safe_park",
          leadId: opts.leadId,
          campaignId: opts.campaignId,
          callId: opts.callId,
          retryReason: plan.retryReason,
          err,
        },
        "retry_schedule_failed_safe_park",
      );
      retryOk = false;
    }
  }

  const park = finalizeV2Park({ plan, retryOk });
  assertV2AnsweredNotFailed({ answeredEver: true, callStatus: park.callStatus });

  if (
    plan.wantsRetry &&
    !retryOk &&
    park.callStatus === "completed" &&
    park.lastAttemptStatus === "dropped"
  ) {
    logger.error(
      {
        event: "retry_schedule_failed_safe_park",
        leadId: opts.leadId,
        campaignId: opts.campaignId,
        callId: opts.callId,
        callStatus: park.callStatus,
        lastAttemptStatus: park.lastAttemptStatus,
        retryReason: plan.retryReason,
      },
      "retry_schedule_failed_safe_park",
    );
  }

  await db
    .update(campaignLeadsTable)
    .set(campaignLeadWritePatch({
      answeredEver: true,
      callStatus: park.callStatus,
      lastAttemptStatus: park.lastAttemptStatus,
    }))
    .where(eq(campaignLeadsTable.id, opts.leadId));

  if (opts.callId) {
    await recordCallExecutionOutcome(opts.callId, park.lastAttemptStatus).catch((err) => {
      logger.warn({ leadId: opts.leadId, callId: opts.callId, err }, "Failed to record call execution outcome");
    });
  }

  return {
    finalCallStatus: park.callStatus,
    lastAttemptStatus: park.lastAttemptStatus,
    retryScheduled: park.retryScheduled,
    retryId,
    retryReason: plan.retryReason,
  };
}

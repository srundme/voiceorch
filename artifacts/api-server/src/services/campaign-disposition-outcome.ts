/**
 * After disposition is known: stamp lead.disposition + recompute operationalOutcome
 * using the agent's disposition meaning map.
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  campaignLeadsTable,
  campaignsTable,
  callCallbacksTable,
  leadTransfersTable,
  bookingsTable,
  scheduledCallbacksTable,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { computeOperationalOutcome, setOperationalOutcome } from "./operational-outcome.js";
import { canonicalDispositionFromLabel } from "../lib/disposition/canonical.js";
import {
  CAMPAIGN_LEAD_STATE_V2_EVENT,
  isBusinessEndingDisposition,
  isCampaignLeadStateV2Writer,
  shouldCancelDroppedRetryAfterDisposition,
  shouldPreserveBusinessDisposition,
} from "./campaign-lead-state-v2.js";
import { cancelPendingDroppedRetries } from "./retryEngine.js";
import {
  dispositionLabelForLead,
  loadAgentMeaningMap,
  meaningFlagsForOutcome,
} from "./disposition-meaning.js";

/**
 * AMD/transcript already marked the call voicemail. Do not let the LLM stamp
 * "outcome: no pickup" over that — operators filter by disposition first.
 */
export function resolveDispositionLabelForCall(opts: {
  incomingLabel: string;
  callStatus?: string | null;
  lastAttemptStatus?: string | null;
}): string {
  const incoming = opts.incomingLabel.trim();
  const isVoicemail =
    opts.callStatus === "voicemail" || opts.lastAttemptStatus === "voicemail";
  if (!isVoicemail) return incoming;
  if (isBusinessEndingDisposition(incoming)) return incoming;
  const bucket = canonicalDispositionFromLabel(incoming);
  if (bucket === "voicemail") return incoming || "outcome: voicemail";
  return "outcome: voicemail";
}

export async function applyCampaignDispositionOutcome(opts: {
  campaignLeadId: number;
  agentId: number;
  callId?: number | null;
  dispositionResult: Record<string, unknown> | null | undefined;
  callStatus?: string;
  wasTransferred?: boolean;
}): Promise<void> {
  const [lead] = await db
    .select()
    .from(campaignLeadsTable)
    .where(eq(campaignLeadsTable.id, opts.campaignLeadId))
    .limit(1);
  if (!lead) return;

  const v2Writer = isCampaignLeadStateV2Writer(lead.campaignId);
  const label = resolveDispositionLabelForCall({
    incomingLabel: dispositionLabelForLead(opts.dispositionResult),
    callStatus: opts.callStatus ?? lead.callStatus,
    lastAttemptStatus: lead.lastAttemptStatus,
  });
  const preserveExisting = v2Writer && shouldPreserveBusinessDisposition({
    existing: lead.disposition,
    incoming: label,
  });
  if (label && !preserveExisting) {
    await db
      .update(campaignLeadsTable)
      .set({ disposition: label })
      .where(
        and(
          eq(campaignLeadsTable.id, lead.id),
          eq(campaignLeadsTable.campaignId, lead.campaignId),
        ),
      );
  }

  const map = await loadAgentMeaningMap(opts.agentId);
  const dispositionForOutcome = (preserveExisting ? lead.disposition : label) || lead.disposition;
  const flags = meaningFlagsForOutcome(
    preserveExisting ? null : opts.dispositionResult,
    map,
    dispositionForOutcome,
  );

  let hasBooking = false;
  if (opts.callId) {
    const [bookingRow] = await db
      .select({ id: bookingsTable.id })
      .from(bookingsTable)
      .where(eq(bookingsTable.callId, opts.callId))
      .limit(1);
    hasBooking = !!bookingRow;
  }

  const [cbRow] = await db
    .select({ id: scheduledCallbacksTable.id })
    .from(scheduledCallbacksTable)
    .where(
      and(
        eq(scheduledCallbacksTable.campaignLeadId, lead.id),
        eq(scheduledCallbacksTable.status, "pending"),
      ),
    )
    .limit(1);

  // Also check CRM-style call_callbacks
  const [legacyCb] = !cbRow
    ? await db
        .select({ id: callCallbacksTable.id })
        .from(callCallbacksTable)
        .where(
          and(eq(callCallbacksTable.leadId, lead.id), eq(callCallbacksTable.status, "pending")),
        )
        .limit(1)
    : [null];

  const [xfer] = await db
    .select({ id: leadTransfersTable.id })
    .from(leadTransfersTable)
    .where(
      and(
        eq(leadTransfersTable.leadId, lead.id),
        eq(leadTransfersTable.outcome, "completed"),
      ),
    )
    .limit(1);

  const [camp] = await db
    .select({ maxAttempts: campaignsTable.maxAttempts })
    .from(campaignsTable)
    .where(eq(campaignsTable.id, lead.campaignId))
    .limit(1);

  const maxAttempts = camp?.maxAttempts ?? 1;
  const maxAttemptsReached = (lead.callAttempts ?? 0) >= maxAttempts;

  const outcome = computeOperationalOutcome({
    callStatus: opts.callStatus ?? lead.callStatus,
    disposition: dispositionForOutcome,
    hasBooking,
    hasCompletedTransfer: opts.wasTransferred === true || !!xfer,
    hasPendingCallback: !!cbRow || !!legacyCb,
    maxAttemptsReached,
    isDncBlocked: false,
    positiveDispositions: flags.positiveDispositions,
    dispositionIsDnc: flags.isDncFromMeaning,
    dispositionIsCallback: flags.isCallbackFromMeaning,
    dispositionIsInterested: flags.meaning === "interested",
  });

  if (!(v2Writer && lead.answeredEver && outcome === "failed")) {
    await setOperationalOutcome(db, lead.id, lead.campaignId, outcome);
  }

  let retryCancelledAfterDisposition = false;
  const dispositionForCancel = dispositionForOutcome;
  if (v2Writer && shouldCancelDroppedRetryAfterDisposition(dispositionForCancel)) {
    const { cancelledIds } = await cancelPendingDroppedRetries({
      leadId: lead.id,
      reason: `disposition:${dispositionForCancel ?? "business"}`,
    });
    retryCancelledAfterDisposition = cancelledIds.length > 0;
    if (retryCancelledAfterDisposition && (lead.callStatus === "pending" || lead.callStatus === "failed")) {
      const parked = lead.answeredEver ? "completed" : lead.callStatus;
      if (parked === "completed") {
        await db
          .update(campaignLeadsTable)
          .set({ callStatus: "completed" })
          .where(eq(campaignLeadsTable.id, lead.id));
      }
    }
    if (retryCancelledAfterDisposition) {
      logger.info(
        {
          event: "campaign_lead_state_v2",
          campaignId: lead.campaignId,
          leadId: lead.id,
          callId: opts.callId ?? null,
          retryCancelledAfterDisposition: true,
          disposition: dispositionForCancel,
          cancelledRetryIds: cancelledIds,
        },
        CAMPAIGN_LEAD_STATE_V2_EVENT,
      );
    }
  }

  logger.info(
    {
      leadId: lead.id,
      campaignId: lead.campaignId,
      disposition: label,
      meaning: flags.meaning,
      outcome,
    },
    "Campaign lead disposition + operational outcome updated",
  );
}

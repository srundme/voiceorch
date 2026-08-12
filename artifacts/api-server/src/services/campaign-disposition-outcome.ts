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
import {
  dispositionLabelForLead,
  loadAgentMeaningMap,
  meaningFlagsForOutcome,
} from "./disposition-meaning.js";

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

  const label = dispositionLabelForLead(opts.dispositionResult);
  if (label) {
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
  const flags = meaningFlagsForOutcome(opts.dispositionResult, map, label || lead.disposition);

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
    disposition: label || lead.disposition,
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

  await setOperationalOutcome(db, lead.id, lead.campaignId, outcome);
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

/**
 * Operational Outcome Engine
 *
 * Operational Outcome is system-generated and immutable — set by the lifecycle
 * engine, never written directly by clients or the AI agent.
 *
 * It provides a workspace-agnostic canonical truth for funnel analytics,
 * regardless of what custom dispositions any individual agent uses.
 *
 * Values (exhaustive):
 *   pending             — no outcome yet (default)
 *   booking_created     — lead has a confirmed booking
 *   transfer_completed  — lead has a completed transfer
 *   callback_requested  — lead has a pending callback
 *   interest_confirmed  — disposition is in workspace positive set
 *   no_contact          — max attempts reached with no connection
 *   dnc_blocked         — lead blocked by DNC list
 *   failed              — system error / max retries exhausted
 */

import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import {
  campaignLeadsTable,
  leadTimelineTable,
  type OperationalOutcome,
} from "@workspace/db/schema";

export type { OperationalOutcome };

// Workspace-configurable positive disposition set.
// When a lead's disposition matches any of these, interest_confirmed is set.
export const DEFAULT_POSITIVE_DISPOSITIONS = new Set([
  "interested",
  "very_interested",
  "wants_callback",
  "follow_up",
  "hot",
  "warm",
]);

/**
 * Compute the correct OperationalOutcome for a lead given its current state.
 * Called by lifecycle hooks after any state-changing event.
 */
export function computeOperationalOutcome(params: {
  callStatus: string;
  disposition: string | null;
  hasBooking: boolean;
  hasCompletedTransfer: boolean;
  hasPendingCallback: boolean;
  maxAttemptsReached: boolean;
  isDncBlocked: boolean;
  positiveDispositions?: Set<string>;
}): OperationalOutcome {
  const {
    callStatus,
    disposition,
    hasBooking,
    hasCompletedTransfer,
    hasPendingCallback,
    maxAttemptsReached,
    isDncBlocked,
    positiveDispositions = DEFAULT_POSITIVE_DISPOSITIONS,
  } = params;

  if (isDncBlocked) return "dnc_blocked";
  if (hasBooking) return "booking_created";
  if (hasCompletedTransfer) return "transfer_completed";
  if (hasPendingCallback) return "callback_requested";
  if (disposition && positiveDispositions.has(disposition.toLowerCase())) {
    return "interest_confirmed";
  }
  if (maxAttemptsReached && callStatus !== "connected") return "no_contact";
  if (callStatus === "failed" || callStatus === "exhausted") return "failed";

  return "pending";
}

/**
 * Persist the operational outcome to the DB and write a timeline event.
 * Idempotent — only writes if the outcome has changed.
 */
export async function setOperationalOutcome(
  db: NodePgDatabase<typeof schema>,
  leadId: number,
  campaignId: number,
  outcome: OperationalOutcome,
): Promise<void> {
  const [current] = await db
    .select({ operationalOutcome: campaignLeadsTable.operationalOutcome })
    .from(campaignLeadsTable)
    .where(eq(campaignLeadsTable.id, leadId))
    .limit(1);

  if (!current || current.operationalOutcome === outcome) return;

  await db
    .update(campaignLeadsTable)
    .set({ operationalOutcome: outcome })
    .where(eq(campaignLeadsTable.id, leadId));

  await db.insert(leadTimelineTable).values({
    leadId,
    campaignId,
    eventType: "operational_outcome_set",
    data: { outcome, previous: current.operationalOutcome },
  });
}

/**
 * Append a timeline event for a lead.
 * Used by all lifecycle hooks and CRM actions.
 */
export async function appendTimeline(
  db: NodePgDatabase<typeof schema>,
  leadId: number,
  campaignId: number,
  eventType: string,
  data?: Record<string, unknown>,
): Promise<void> {
  await db.insert(leadTimelineTable).values({
    leadId,
    campaignId,
    eventType,
    data: data ?? {},
  });
}

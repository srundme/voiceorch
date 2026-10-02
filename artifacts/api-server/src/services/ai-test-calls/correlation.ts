/**
 * Link the inbound (target agent) leg of an AI Test Call to its run.
 *
 * A real PSTN call carries no custom header from the dialing leg to the
 * answering leg, so the inbound session is matched on facts the platform
 * controls: the answering agent is the run's target, the caller ID is the
 * persona line recorded just before the carrier dial, the dialed number is the
 * run's target DID, and the dial happened within the correlation window.
 * The UPDATE ... WHERE callee_call_id IS NULL with FOR UPDATE SKIP LOCKED makes
 * the claim atomic: one inbound leg can claim one run, never two.
 */

import { sql } from "drizzle-orm";
import { db, callsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { CORRELATION_WINDOW_SECONDS, phoneLast10 } from "./policy.js";

export interface InboundLegFacts {
  callId: number;
  agentId: number;
  fromNumber: string | null | undefined;
  toNumber: string | null | undefined;
}

/** Inputs that can never belong to a test run — skips the DB round-trip. */
export function canBeTestLeg(leg: InboundLegFacts): boolean {
  if (!leg.callId || !leg.agentId) return false;
  const from = String(leg.fromNumber ?? "");
  if (from.startsWith("webcall") || from.startsWith("meet")) return false;
  return phoneLast10(from).length === 10;
}

export async function claimInboundTestLeg(leg: InboundLegFacts): Promise<number | null> {
  if (!canBeTestLeg(leg)) return null;
  const from10 = phoneLast10(leg.fromNumber);
  const to10 = phoneLast10(leg.toNumber);
  const result = await db.execute(sql`
    UPDATE simulation_runs SET
      callee_call_id = ${leg.callId},
      status = CASE WHEN status = 'dialing' THEN 'in_call' ELSE status END,
      updated_at = now()
    WHERE id = (
      SELECT id FROM simulation_runs
      WHERE agent_id = ${leg.agentId}
        AND status IN ('dialing', 'in_call')
        AND callee_call_id IS NULL
        AND dial_started_at > now() - make_interval(secs => ${CORRELATION_WINDOW_SECONDS})
        AND right(regexp_replace(coalesce(caller_from_number, ''), '[^0-9]', '', 'g'), 10) = ${from10}
        AND (${to10} = '' OR right(regexp_replace(coalesce(target_number, ''), '[^0-9]', '', 'g'), 10) = ${to10})
      ORDER BY dial_started_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    AND callee_call_id IS NULL
    RETURNING id
  `);
  const rows = (result as unknown as { rows?: Array<{ id: number }> }).rows ?? [];
  const runId = rows[0]?.id ?? null;
  if (runId == null) return null;
  await db.update(callsTable)
    .set({ isTest: true, testRunId: runId })
    .where(eq(callsTable.id, leg.callId));
  logger.info({ runId, callId: leg.callId, agentId: leg.agentId }, "ai-test-calls: inbound leg linked to test run");
  return runId;
}

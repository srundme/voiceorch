/**
 * TRAI (Telecom Regulatory Authority of India) compliance gate.
 * ─────────────────────────────────────────────────────────────────────────────
 * A pre/post wrapper only — it does NOT touch the STT/LLM/TTS pipeline or
 * conversation logic. It enforces:
 *   1. Calling-hours window (9 AM–9 PM IST) — pre-dial.
 *   2. Suppression-list (full_dnd / opted_out) — pre-dial.
 *   3. Opt-out disclosure injection into the system prompt.
 *   4. Caller opt-out auto-detection in the transcript — post-call.
 *
 * The enabled flag lives on the agent's existing `agent_config.compliance.trai`
 * boolean — this module never reads a separate column.
 */

import { db, traiSuppressionListTable, traiCallComplianceLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { normalizePhone } from "../../lib/phone-normalize.js";
import { logger } from "../../lib/logger.js";

/**
 * TRAI calling hours are evaluated in the agent's own timezone, falling back to
 * IST when the agent has no timezone configured (TRAI is an India regulation).
 */
const DEFAULT_TRAI_TIMEZONE = "Asia/Kolkata";
const CALL_START_HOUR = 9;  // 9 AM inclusive
const CALL_END_HOUR = 21;   // 9 PM — calls must start before 21:00

/** Statuses on the suppression list that block dialing. */
const BLOCKING_STATUSES = new Set(["full_dnd", "opted_out"]);

/** Phrases that indicate a caller wants to opt out of future calls. */
const OPT_OUT_PHRASES = [
  "stop calling",
  "remove my number",
  "don't call again",
  "dont call again",
  "do not call",
  "unsubscribe",
  "stop contacting",
];

export interface PreDialResult {
  allowed: boolean;
  reason: string | null;
}

/**
 * Pre-dial check for a TRAI-enabled agent. Verifies the current local hour (in
 * the agent's timezone, defaulting to IST) is within the 9 AM–9 PM window and
 * that the destination number is not on the suppression list with a blocking
 * status.
 */
export async function traiPreDialCheck(
  phoneNumber: string,
  timezone?: string | null,
): Promise<PreDialResult> {
  // 1. Calling-hours window (agent timezone, default IST)
  const tz = timezone || DEFAULT_TRAI_TIMEZONE;
  const hourStr = formatInTimeZone(new Date(), tz, "H");
  const hour = Number(hourStr);
  if (hour < CALL_START_HOUR || hour >= CALL_END_HOUR) {
    return {
      allowed: false,
      reason: `Outside permitted calling hours (9 AM–9 PM ${tz}). Current hour: ${hour}.`,
    };
  }

  // 2. Suppression-list check
  const normalized = normalizePhone(phoneNumber);
  const [row] = await db
    .select({ status: traiSuppressionListTable.status })
    .from(traiSuppressionListTable)
    .where(eq(traiSuppressionListTable.phoneNumber, normalized))
    .limit(1);

  if (row && BLOCKING_STATUSES.has(row.status)) {
    return {
      allowed: false,
      reason: `Number is on the TRAI suppression list (status: ${row.status}).`,
    };
  }

  return { allowed: true, reason: null };
}

/**
 * Append the fixed TRAI promotional-call + respectful-opt-out disclosure to a
 * base system prompt. Single source of truth — also used by session.ts so the
 * disclosure is never duplicated.
 */
export function appendTraiDisclosure(basePrompt: string): string {
  return `${basePrompt}\n\n[TRAI COMPLIANCE — MANDATORY] As per TRAI regulations for commercial communications, at the start of every call you MUST say: "This is a commercial communication. If you wish to stop receiving such calls, please say STOP at any time and we will immediately remove you from our list." If the caller says STOP or asks to be removed, apologize sincerely and end the call immediately without any sales pitch.`;
}

/**
 * Write a pre-dial compliance log row. Best-effort — never throws into the
 * caller's dial path.
 */
export async function logPreDialDecision(params: {
  agentId: number | null;
  callId: number | null;
  phoneNumber: string;
  allowed: boolean;
  reason: string | null;
}): Promise<void> {
  try {
    await db.insert(traiCallComplianceLogTable).values({
      agentId: params.agentId,
      callId: params.callId,
      phoneNumber: normalizePhone(params.phoneNumber),
      preDialStatus: params.allowed ? "allowed" : "blocked",
      blockReason: params.reason,
      optOutDetected: false,
    });
  } catch (err) {
    logger.warn({ err, phoneNumber: params.phoneNumber }, "Failed to write TRAI pre-dial compliance log");
  }
}

/**
 * Scan a finalized transcript for caller opt-out phrases. On detection, upsert
 * the number into the suppression list as `opted_out` and write a compliance
 * log row. Best-effort — never throws.
 */
export async function scanForOptOut(
  agentId: number | null,
  callId: number | null,
  phoneNumber: string | null,
  transcript: string | null,
): Promise<boolean> {
  if (!phoneNumber || !transcript) return false;

  const haystack = transcript.toLowerCase();
  const matched = OPT_OUT_PHRASES.some((p) => haystack.includes(p));
  if (!matched) return false;

  const normalized = normalizePhone(phoneNumber);
  try {
    await db
      .insert(traiSuppressionListTable)
      .values({
        phoneNumber: normalized,
        status: "opted_out",
        source: "opt_out_detected",
      })
      .onConflictDoUpdate({
        target: traiSuppressionListTable.phoneNumber,
        set: { status: "opted_out", source: "opt_out_detected", addedAt: new Date() },
      });

    await db.insert(traiCallComplianceLogTable).values({
      agentId,
      callId,
      phoneNumber: normalized,
      preDialStatus: null,
      blockReason: null,
      optOutDetected: true,
    });

    logger.info({ agentId, callId, phoneNumber: normalized }, "TRAI opt-out detected — number suppressed");
    return true;
  } catch (err) {
    logger.warn({ err, agentId, callId, phoneNumber: normalized }, "Failed to record TRAI opt-out");
    return false;
  }
}

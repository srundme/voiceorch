/**
 * DPDP (Digital Personal Data Protection Act 2023) compliance wrapper.
 * ─────────────────────────────────────────────────────────────────────────────
 * A pre/post wrapper only — it does NOT touch the STT/LLM/TTS pipeline or
 * conversation logic, and CRITICALLY it never blocks a call from dialing.
 *
 * Unlike TRAI there is no pre-dial gate. This module only:
 *   1. Appends a fixed data-purpose disclosure to the system prompt.
 *   2. Flags whether PII was present in a finalized transcript (analytics-only;
 *      the transcript itself is never altered).
 *   3. Processes admin-triggered erasure requests (right to be forgotten).
 *
 * The enabled flag lives on the agent's existing `agent_config.compliance.dpdp`
 * boolean — this module never reads a separate column.
 *
 * Every function is best-effort and must never throw into its caller.
 */

import {
  db,
  callsTable,
  callRecordingsTable,
  dpdpCallComplianceLogTable,
  dpdpErasureRequestsTable,
  agentsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { normalizePhone } from "../../lib/phone-normalize.js";
import { logger } from "../../lib/logger.js";

/**
 * Append the fixed DPDP data-purpose disclosure to a base system prompt.
 * Single source of truth — used by session.ts so the disclosure is never
 * duplicated. `purpose` is an optional, human-readable reason the call may
 * collect personal data; it is woven into the instruction when provided.
 */
export function appendDpdpDisclosure(basePrompt: string, purpose?: string | null): string {
  const purposeClause = purpose && purpose.trim()
    ? ` The purpose of any data collection on this call is: ${purpose.trim()}.`
    : "";
  return `${basePrompt}\n\n[DPDP ACT COMPLIANCE — MANDATORY] As per the Digital Personal Data Protection Act 2023, BEFORE requesting any personal data (name, phone, email, ID numbers, date of birth, address, financial details), you MUST inform the caller: "This call may involve collection of your personal data. By continuing, you consent to its processing as per our privacy policy and the DPDP Act 2023."${purposeClause} Do not collect personal information until the caller agrees to continue.`;
}

/** Regex patterns used to flag PII presence in a transcript. */
const PII_PATTERNS: { name: string; re: RegExp }[] = [
  // Phone numbers (Indian + generic E.164-ish: 10–15 digits, optional +/spaces/dashes)
  { name: "phone", re: /(?:\+?\d[\d\s-]{8,14}\d)/ },
  // Email addresses
  { name: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  // Aadhaar (12 digits, often grouped 4-4-4)
  { name: "aadhaar", re: /\b\d{4}\s?\d{4}\s?\d{4}\b/ },
  // PAN (5 letters, 4 digits, 1 letter)
  { name: "pan", re: /\b[A-Za-z]{5}\d{4}[A-Za-z]\b/ },
  // Generic government/ID number (alnum 8–20 with at least one digit) — kept loose
  { name: "id", re: /\b(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{8,20}\b/ },
  // Date of birth: dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd, dd.mm.yyyy
  { name: "dob", re: /\b(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}[/.-]\d{1,2}[/.-]\d{1,2})\b/ },
];

/**
 * Scan a finalized transcript for PII and write a `dpdp_call_compliance_log`
 * row recording whether PII was detected. Does NOT alter the transcript — the
 * flag is for downstream analytics redaction only. Best-effort; never throws.
 */
export async function scanAndRedactPII(
  agentId: number | null,
  callId: number | null,
  phoneNumber: string | null,
  transcript: string | null,
): Promise<boolean> {
  const piiDetected = !!transcript && PII_PATTERNS.some((p) => p.re.test(transcript));
  try {
    await db.insert(dpdpCallComplianceLogTable).values({
      agentId,
      callId,
      phoneNumber: phoneNumber ? normalizePhone(phoneNumber) : "unknown",
      piiDetected,
    });
    if (piiDetected) {
      logger.info({ agentId, callId }, "DPDP: PII detected in transcript (flagged for redaction)");
    }
    return piiDetected;
  } catch (err) {
    logger.warn({ err, agentId, callId }, "Failed to write DPDP call compliance log");
    return piiDetected;
  }
}

const REDACTED = "[REDACTED]";

/**
 * Anonymize the PII fields on a set of call rows: phone numbers, transcript,
 * summary, recording URL, and any stored binary recordings. Best-effort.
 * Returns the number of call rows anonymized.
 */
async function anonymizeCalls(callIds: number[]): Promise<number> {
  let anonymized = 0;
  for (const id of callIds) {
    try {
      await db.update(callsTable).set({
        toNumber: REDACTED,
        fromNumber: REDACTED,
        transcript: null,
        callSummary: null,
        recordingUrl: null,
      }).where(eq(callsTable.id, id));
      await db.delete(callRecordingsTable).where(eq(callRecordingsTable.callId, id));
      anonymized++;
    } catch (err) {
      logger.warn({ err, callId: id }, "DPDP: failed to anonymize call");
    }
  }
  return anonymized;
}

/**
 * Admin-triggered erasure (right to be forgotten). Marks all call logs,
 * transcripts, and recordings for the given phone number for
 * deletion/anonymization, and records a `dpdp_erasure_requests` row with
 * status "completed". Manual/admin-triggered only — never automatic.
 * Best-effort; never throws.
 */
export async function processErasureRequest(
  phoneNumber: string,
): Promise<{ anonymizedCalls: number }> {
  const normalized = normalizePhone(phoneNumber);
  let anonymizedCalls = 0;
  try {
    const rows = await db
      .select({ id: callsTable.id })
      .from(callsTable)
      .where(eq(callsTable.toNumber, normalized));
    anonymizedCalls = await anonymizeCalls(rows.map((r) => r.id));
  } catch (err) {
    logger.warn({ err, phoneNumber: normalized }, "DPDP: erasure call lookup failed");
  }

  try {
    await db.insert(dpdpErasureRequestsTable).values({
      phoneNumber: normalized,
      status: "completed",
      processedAt: new Date(),
    });
  } catch (err) {
    logger.warn({ err, phoneNumber: normalized }, "DPDP: failed to record erasure request");
  }

  logger.info({ phoneNumber: normalized, anonymizedCalls }, "DPDP: erasure request processed");
  return { anonymizedCalls };
}

/**
 * IRDAI/RBI mandatory minimum recording retention: 6 months (180 days).
 *
 * DPDP wants to anonymize PII after `retentionDays`; IRDAI/RBI require
 * recordings to EXIST for at least 180 days. These are in direct conflict when
 * `retentionDays < 180`. Resolution: for any call whose agent had IRDAI enabled,
 * the effective retention is max(retentionDays, IRDAI_MIN_RETENTION_DAYS). The
 * DPDP sweep respects this floor — it will not anonymize IRDAI-covered calls
 * until both windows have passed.
 */
const IRDAI_MIN_RETENTION_DAYS = 180;

/**
 * Daily retention sweep: anonymize PII on DPDP-enabled calls older than
 * `retentionDays`. A call counts as DPDP-enabled if it has a
 * `dpdp_call_compliance_log` row. Best-effort; never throws.
 *
 * Retention-conflict resolution: calls belonging to agents with
 * `agentConfig.compliance.irdai = true` are subject to an IRDAI minimum
 * retention window of 180 days — they will not be anonymized until
 * max(retentionDays, 180) days have elapsed, even if `retentionDays` is
 * shorter. After the IRDAI window expires, DPDP anonymization proceeds
 * normally.
 */
export async function anonymizeExpiredDpdpCalls(retentionDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  // Separate cutoff for IRDAI-covered calls (max of the two retention windows).
  const irdaiCutoff = new Date(
    Date.now() - Math.max(retentionDays, IRDAI_MIN_RETENTION_DAYS) * 24 * 60 * 60 * 1000,
  );
  try {
    // A call is DPDP-enabled iff it has a dpdp_call_compliance_log row. Also
    // join agents so we can apply the IRDAI retention floor per-call.
    const rows = await db
      .select({
        id: callsTable.id,
        createdAt: callsTable.createdAt,
        toNumber: callsTable.toNumber,
        agentConfig: agentsTable.agentConfig,
      })
      .from(callsTable)
      .innerJoin(dpdpCallComplianceLogTable, eq(dpdpCallComplianceLogTable.callId, callsTable.id))
      .leftJoin(agentsTable, eq(agentsTable.id, callsTable.agentId));

    const toAnonymize = rows
      .filter((r) => {
        if (r.toNumber === REDACTED) return false; // already anonymized
        // Check if the call's agent currently has IRDAI enabled.
        const cfg = r.agentConfig as { compliance?: { irdai?: boolean } } | null;
        const irdaiEnabled = !!cfg?.compliance?.irdai;
        // Apply the stricter cutoff for IRDAI-covered calls.
        const effectiveCutoff = irdaiEnabled ? irdaiCutoff : cutoff;
        return r.createdAt < effectiveCutoff;
      })
      .map((r) => r.id);

    if (toAnonymize.length === 0) return 0;
    const n = await anonymizeCalls(toAnonymize);
    logger.info({ retentionDays, anonymized: n }, "DPDP: retention sweep anonymized expired calls");
    return n;
  } catch (err) {
    logger.warn({ err, retentionDays }, "DPDP: retention sweep failed");
    return 0;
  }
}

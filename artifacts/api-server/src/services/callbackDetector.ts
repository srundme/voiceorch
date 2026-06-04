/**
 * Callback Detector
 * ─────────────────────────────────────────────────────────────────────────────
 * After a call ends, scans the call summary / transcript for callback intent.
 * Creates a call_callbacks row when detected.
 */

import { db, callCallbacksTable, leadTimelineTable, campaignLeadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const CALLBACK_PATTERNS = [
  /call\s+(me\s+)?(back|later|tomorrow|tonight|next\s+week|next\s+month)/i,
  /call\s+again/i,
  /try\s+again\s+later/i,
  /not\s+a\s+good\s+time/i,
  /busy\s+right\s+now/i,
  /in\s+(?:a\s+)?(?:few|couple\s+of)\s+(?:hours?|days?|minutes?)/i,
  /(?:afternoon|evening|morning|weekend)/i,
  /reach\s+me\s+at/i,
  /callback/i,
  /ring\s+me/i,
  /give\s+me\s+a\s+call/i,
];

function extractCallbackHint(text: string): { detected: boolean; rawExtract: string | null } {
  for (const pattern of CALLBACK_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const start = Math.max(0, (match.index ?? 0) - 40);
      const end = Math.min(text.length, (match.index ?? 0) + (match[0]?.length ?? 0) + 40);
      return { detected: true, rawExtract: text.slice(start, end).trim() };
    }
  }
  return { detected: false, rawExtract: null };
}

/**
 * Inspect a finished call's summary/transcript and create a callback record
 * if callback intent is detected.
 */
export async function detectAndCreateCallback(opts: {
  callId: number;
  leadId: number;
  campaignId: number;
  callSummary: string | null;
  transcript: string | null;
}): Promise<void> {
  const { callId, leadId, campaignId, callSummary, transcript } = opts;

  const textToScan = [callSummary ?? "", transcript ?? ""].join(" ").trim();
  if (!textToScan) return;

  const { detected, rawExtract } = extractCallbackHint(textToScan);
  if (!detected) return;

  const [existing] = await db.select({ id: callCallbacksTable.id })
    .from(callCallbacksTable)
    .where(eq(callCallbacksTable.callId, callId))
    .limit(1);

  if (existing) return;

  await db.insert(callCallbacksTable).values({
    leadId,
    campaignId,
    callId,
    reason:     rawExtract ?? "Callback intent detected",
    rawExtract,
    status:     "pending",
  });

  await db.insert(leadTimelineTable).values({
    leadId,
    campaignId,
    eventType: "callback_detected",
    data:      { callId, rawExtract },
  });

  await db.update(campaignLeadsTable)
    .set({ disposition: "callback_requested" })
    .where(eq(campaignLeadsTable.id, leadId));

  logger.info({ callId, leadId, campaignId, rawExtract }, "Callback intent detected");
}

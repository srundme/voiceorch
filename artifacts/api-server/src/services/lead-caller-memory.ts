/**
 * Sync campaign-lead operator updates into caller memory + leadData so the
 * next campaign dial (LEAD CONTEXT) and any inbound follow-up (CALLER MEMORY)
 * both see the current request status.
 */

import { db, campaignLeadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  upsertExternalCallerFacts,
  sanitizeLeadContextKey,
  OPERATOR_UPDATE_FACT_KEY,
  type ExternalMemoryUpdate,
  type WrittenCallerFact,
} from "../orchestration/callerMemory.js";
import { logger } from "../lib/logger.js";

export async function applyCampaignLeadMemoryUpdate(opts: {
  agentId: number | null | undefined;
  leadId: number;
  phone: string;
  currentLeadData: Record<string, string> | null | undefined;
  update: ExternalMemoryUpdate;
}): Promise<{ written: WrittenCallerFact[]; leadData: Record<string, string>; phoneNumber: string | null }> {
  let written: WrittenCallerFact[] = [];
  let phoneNumber: string | null = null;

  if (opts.agentId && opts.phone) {
    try {
      const result = await upsertExternalCallerFacts({
        agentId: opts.agentId,
        phoneNumber: opts.phone,
        update: opts.update,
      });
      written = result.written;
      phoneNumber = result.phoneNumber;
    } catch (err) {
      logger.warn(
        { err, leadId: opts.leadId, agentId: opts.agentId },
        "Failed to write caller memory from campaign lead update",
      );
    }
  }

  const merged: Record<string, string> = { ...(opts.currentLeadData ?? {}) };
  if (opts.update.note?.trim()) {
    merged[OPERATOR_UPDATE_FACT_KEY] = opts.update.note.trim();
  }
  const pairs: Array<{ key: string; value: string }> = [
    ...(opts.update.facts ?? []),
    ...Object.entries(opts.update.context ?? {}).map(([key, value]) => ({ key, value })),
  ];
  for (const pair of pairs) {
    const key = sanitizeLeadContextKey(pair.key);
    const value = pair.value.trim();
    if (!key || !value) continue;
    merged[key] = value;
  }

  try {
    await db.update(campaignLeadsTable)
      .set({ leadData: merged })
      .where(eq(campaignLeadsTable.id, opts.leadId));
  } catch (err) {
    logger.warn({ err, leadId: opts.leadId }, "Failed to merge operator updates into campaign leadData");
  }

  return { written, leadData: merged, phoneNumber };
}

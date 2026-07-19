/**
 * Sync Automatic Calls row/pipeline counters from campaign dial outcomes.
 * Keeps sheet_auto_call_row_state in lockstep with campaign_leads so the UI
 * does not sit on "Enqueued" forever when dial is skipped or fails.
 */

import { and, eq, sql } from "drizzle-orm";
import {
  db,
  sheetAutoCallPipelinesTable,
  sheetAutoCallRowStateTable,
  type SheetAutoRowStatus,
} from "@workspace/db";

type LeadLike = {
  id: number;
  leadData?: Record<string, unknown> | null;
};

function sheetMeta(lead: LeadLike): { pipelineId: string; sheetRowIndex: number } | null {
  const ld = (lead.leadData ?? {}) as Record<string, string>;
  const pipelineId = ld["__sheet_pipeline_id"];
  const ri = Number(ld["__sheet_row_index"]);
  if (!pipelineId || !Number.isFinite(ri) || ri < 2) return null;
  return { pipelineId, sheetRowIndex: ri };
}

export async function syncSheetAutoCallDialStatus(
  lead: LeadLike,
  opts: {
    status: SheetAutoRowStatus;
    error?: string | null;
    /** Increment pipeline dialed_count (actual outbound dial placed). */
    bumpDialed?: boolean;
    /** Increment pipeline failed_count. */
    bumpFailed?: boolean;
  },
): Promise<void> {
  const meta = sheetMeta(lead);
  if (!meta) return;

  await db.update(sheetAutoCallRowStateTable)
    .set({
      leadId: lead.id,
      status: opts.status,
      error: opts.error ?? null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(sheetAutoCallRowStateTable.pipelineId, meta.pipelineId),
      eq(sheetAutoCallRowStateTable.sheetRowIndex, meta.sheetRowIndex),
    ));

  if (opts.bumpDialed || opts.bumpFailed) {
    await db.update(sheetAutoCallPipelinesTable)
      .set({
        ...(opts.bumpDialed
          ? { dialedCount: sql`${sheetAutoCallPipelinesTable.dialedCount} + 1` }
          : {}),
        ...(opts.bumpFailed
          ? { failedCount: sql`${sheetAutoCallPipelinesTable.failedCount} + 1` }
          : {}),
        ...(opts.bumpDialed && !opts.error
          ? { lastError: null }
          : opts.error
            ? { lastError: opts.error.slice(0, 500) }
            : {}),
        updatedAt: new Date(),
      })
      .where(eq(sheetAutoCallPipelinesTable.id, meta.pipelineId));
  } else if (opts.error) {
    await db.update(sheetAutoCallPipelinesTable)
      .set({
        lastError: opts.error.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(sheetAutoCallPipelinesTable.id, meta.pipelineId));
  }
}

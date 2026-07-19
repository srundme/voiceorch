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
  type SheetAutoStatusColumns,
} from "@workspace/db";
import { updateSheetRowByIndex } from "./google-sheets.js";
import { friendlySheetStatus } from "./sheet-auto-calls-helpers.js";
import { logger } from "../lib/logger.js";

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

  // Mirror Queued / Calling / Failed into the sheet Status column
  const [pipeline] = await db
    .select()
    .from(sheetAutoCallPipelinesTable)
    .where(eq(sheetAutoCallPipelinesTable.id, meta.pipelineId))
    .limit(1);
  if (
    pipeline
    && (pipeline.writebackMode === "same_sheet" || pipeline.writebackMode === "both")
  ) {
    const col = (pipeline.sameSheetStatusColumns as SheetAutoStatusColumns | null)?.status ?? "Status";
    const label = friendlySheetStatus(opts.status);
    try {
      await updateSheetRowByIndex(
        pipeline.userId,
        pipeline.connectionId,
        pipeline.spreadsheetId,
        pipeline.sheetName,
        meta.sheetRowIndex,
        { [col]: label },
      );
    } catch (err) {
      logger.warn({ err, pipelineId: pipeline.id }, "sheet-auto-call: dial status sheet write failed");
    }
  }
}

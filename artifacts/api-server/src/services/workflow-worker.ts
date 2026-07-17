/**
 * Background worker for the workflow engine.
 *
 * Every tick it (1) resumes runs waiting on a completed call, (2) resumes runs
 * whose delay timer elapsed, and (3) polls sheet_row triggers for new rows.
 * Follows the same DB-table + setInterval pattern as batchScheduler /
 * callbackScheduler so it survives restarts without a job queue.
 */

import { db, workflowsTable, type Workflow, type WorkflowTrigger } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { readNewRows, type SheetRow } from "./google-sheets.js";
import { resumeWaitingCallRuns, resumeDelayedRuns, startWorkflowRun } from "./workflow-engine.js";

const TICK_MS = 15_000;
let started = false;

export function startWorkflowWorker(): void {
  if (started) return;
  started = true;
  const timer = setInterval(() => { void tick(); }, TICK_MS);
  timer.unref?.();
  setTimeout(() => { void tick(); }, 8_000); // initial kick shortly after boot
  logger.info("workflow-worker started");
}

async function tick(): Promise<void> {
  try { await resumeWaitingCallRuns(); } catch (err) { logger.warn({ err }, "workflow-worker: resume calls failed"); }
  try { await resumeDelayedRuns(); } catch (err) { logger.warn({ err }, "workflow-worker: resume delays failed"); }
  try { await pollSheetTriggers(); } catch (err) { logger.warn({ err }, "workflow-worker: sheet poll failed"); }
}

function buildContextFromRow(trigger: WorkflowTrigger, values: Record<string, string>): Record<string, unknown> {
  const ctx: Record<string, unknown> = { ...values };
  if (trigger.phoneColumn && values[trigger.phoneColumn]) ctx["phone"] = values[trigger.phoneColumn];
  if (trigger.fieldMap) {
    for (const [col, key] of Object.entries(trigger.fieldMap)) {
      if (values[col] !== undefined) ctx[key] = values[col];
    }
  }
  return ctx;
}

async function pollSheetTriggers(): Promise<void> {
  const workflows = await db.select().from(workflowsTable).where(eq(workflowsTable.status, "active"));
  for (const wf of workflows as Workflow[]) {
    const t = wf.trigger;
    if (!t || t.type !== "sheet_row") continue;
    if (!t.connectionId || !t.spreadsheetId || !t.sheetName) continue;

    const state = (wf.triggerState ?? {}) as { lastRow?: number };
    const hasCursor = typeof state.lastRow === "number";

    const { rows, lastRow } = await readNewRows(
      t.connectionId, t.spreadsheetId, t.sheetName,
      hasCursor ? state.lastRow! : 1,
    );

    // First observation of an active sheet trigger: seed the cursor at the
    // current bottom of the sheet so we never mass-dial pre-existing rows.
    if (!hasCursor) {
      await db.update(workflowsTable)
        .set({ triggerState: { ...state, lastRow } })
        .where(eq(workflowsTable.id, wf.id));
      continue;
    }

    if (rows.length === 0) continue;
    for (const row of rows as SheetRow[]) {
      try {
        await startWorkflowRun({
          workflow: wf,
          context: buildContextFromRow(t, row.values),
          triggeredBy: "sheet_row",
        });
      } catch (err) {
        logger.warn({ workflowId: wf.id, row: row._row, err }, "workflow-worker: failed to start run for sheet row");
      }
    }
    await db.update(workflowsTable)
      .set({ triggerState: { ...state, lastRow } })
      .where(eq(workflowsTable.id, wf.id));
  }
}

/**
 * Call plans Phase 3 — Start once / Keep live from a Google Sheet pipeline.
 * Reuses Automatic Calls sheet connections; starts journey workflow runs
 * instead of (or in addition to) the sheet dialer campaign path.
 */

import { and, eq } from "drizzle-orm";
import {
  db,
  journeysTable,
  workflowsTable,
  sheetAutoCallPipelinesTable,
  type Journey,
  type JourneySettings,
  type SheetAutoCallPipeline,
  type SheetAutoColumnMap,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { readSheetGrid } from "./google-sheets.js";
import {
  parseSheetLeadRow,
  isDoNotDialValue,
  resolveDoNotDialHeader,
} from "./sheet-auto-calls-helpers.js";
import { startWorkflowRun } from "./workflow-engine.js";

export type SheetPerson = {
  phone: string;
  name?: string;
  email?: string;
  meetingUrl?: string;
  sheetRowIndex: number;
};

function cellAtHeader(headers: string[], row: string[], header: string | undefined): string {
  if (!header) return "";
  const idx = headers.findIndex((h) => h.toLowerCase() === header.toLowerCase());
  if (idx < 0) return "";
  return String(row[idx] ?? "").trim();
}

function findMeetingUrl(headers: string[], row: string[]): string {
  const candidates = ["meeting url", "meeting link", "meet link", "meet url", "zoom link", "teams link"];
  for (let i = 0; i < headers.length; i++) {
    const h = (headers[i] ?? "").toLowerCase().trim();
    if (candidates.some((c) => h === c || h.includes(c))) {
      const v = String(row[i] ?? "").trim();
      if (/^https:\/\//i.test(v)) return v;
    }
  }
  return "";
}

/** Read dialable people from a sheet pipeline (1-based rows after header). */
export async function listSheetPipelinePeople(
  pipeline: SheetAutoCallPipeline,
  opts: { fromRowExclusive?: number; limit?: number },
): Promise<{ people: SheetPerson[]; lastRow: number }> {
  const grid = await readSheetGrid(
    pipeline.userId,
    pipeline.connectionId,
    pipeline.spreadsheetId,
    pipeline.sheetName,
  );
  const { headers, rows } = grid;
  const lastRow = rows.length + 1;
  const columnMap = pipeline.columnMap as SheetAutoColumnMap;
  const dncHeader = resolveDoNotDialHeader(headers, columnMap);
  const fromExclusive = opts.fromRowExclusive ?? 1;
  const limit = Math.min(Math.max(1, opts.limit ?? 100), 100);
  const people: SheetPerson[] = [];

  for (let i = 0; i < rows.length; i++) {
    const sheetRowIndex = i + 2;
    if (sheetRowIndex <= fromExclusive) continue;
    const row = rows[i]!;
    if (dncHeader && isDoNotDialValue(cellAtHeader(headers, row, dncHeader))) continue;
    const parsed = parseSheetLeadRow(headers, row, columnMap);
    const phone = (parsed.phoneRaw || parsed.phoneNormalized || "").trim();
    if (!phone) continue;
    people.push({
      phone,
      name: parsed.name || undefined,
      email: parsed.email || undefined,
      meetingUrl: findMeetingUrl(headers, row) || undefined,
      sheetRowIndex,
    });
    if (people.length >= limit) break;
  }

  return { people, lastRow };
}

export async function loadOwnedSheetPipeline(
  userId: string,
  pipelineId: string,
): Promise<SheetAutoCallPipeline | null> {
  const [pipeline] = await db.select().from(sheetAutoCallPipelinesTable)
    .where(and(
      eq(sheetAutoCallPipelinesTable.id, pipelineId),
      eq(sheetAutoCallPipelinesTable.userId, userId),
    ))
    .limit(1);
  return pipeline ?? null;
}

/** Sync journey → workflow, then start one run per person. */
export async function startCallPlanRunsForPeople(opts: {
  journey: Journey;
  workflowId: number;
  people: SheetPerson[];
  triggeredBy: string;
  sheetPipelineId?: string | null;
}): Promise<number[]> {
  const [workflow] = await db.select().from(workflowsTable)
    .where(and(
      eq(workflowsTable.id, opts.workflowId),
      eq(workflowsTable.userId, opts.journey.userId),
    ))
    .limit(1);
  if (!workflow) throw new Error("Backing workflow missing");

  const pipelineId = opts.sheetPipelineId
    ?? ((opts.journey.settings ?? {}) as JourneySettings).sheetPipelineId
    ?? null;

  const runIds: number[] = [];
  for (const person of opts.people) {
    const runId = await startWorkflowRun({
      workflow,
      context: {
        phone: person.phone,
        ...(person.name ? { name: person.name } : {}),
        ...(person.email ? { email: person.email } : {}),
        ...(person.meetingUrl
          ? { meetingUrl: person.meetingUrl, meetLink: person.meetingUrl }
          : {}),
        ...(pipelineId
          ? {
              __sheet_pipeline_id: pipelineId,
              sheetPipelineId: pipelineId,
              __sheet_row_index: person.sheetRowIndex,
              sheetRowIndex: person.sheetRowIndex,
            }
          : {}),
        callPlanId: opts.journey.id,
        agentId: opts.journey.agentId,
      },
      triggeredBy: opts.triggeredBy,
    });
    runIds.push(runId);
  }
  return runIds;
}

/**
 * Keep live tick — for each active call plan with runMode=live + sheetPipelineId,
 * start runs for new sheet rows after the stored cursor.
 */
export async function tickLiveCallPlans(): Promise<void> {
  const rows = await db.select().from(journeysTable)
    .where(eq(journeysTable.status, "active"));

  for (const journey of rows) {
    const settings = (journey.settings ?? {}) as JourneySettings;
    if (settings.runMode !== "live") continue;
    const pipelineId = settings.sheetPipelineId?.trim();
    if (!pipelineId || !journey.workflowId) continue;

    try {
      const pipeline = await loadOwnedSheetPipeline(journey.userId, pipelineId);
      if (!pipeline) continue;

      const cursor = typeof settings.sheetCursorRow === "number" ? settings.sheetCursorRow : 1;
      const { people, lastRow } = await listSheetPipelinePeople(pipeline, {
        fromRowExclusive: cursor,
        limit: 25,
      });
      if (people.length === 0) {
        if (lastRow > cursor) {
          await db.update(journeysTable).set({
            settings: { ...settings, sheetCursorRow: lastRow },
          }).where(eq(journeysTable.id, journey.id));
        }
        continue;
      }

      const runIds = await startCallPlanRunsForPeople({
        journey,
        workflowId: journey.workflowId,
        people,
        triggeredBy: "call_plan_live",
      });
      const maxRow = Math.max(...people.map((p) => p.sheetRowIndex), cursor);
      await db.update(journeysTable).set({
        settings: {
          ...settings,
          peopleSource: "sheet",
          sheetPipelineId: pipelineId,
          runMode: "live",
          sheetCursorRow: Math.max(maxRow, lastRow > maxRow ? maxRow : maxRow),
        },
        lastRunAt: new Date(),
      }).where(eq(journeysTable.id, journey.id));

      logger.info(
        { journeyId: journey.id, started: runIds.length, cursor: maxRow },
        "call-plan live: started sheet rows",
      );
    } catch (err) {
      logger.warn({ err, journeyId: journey.id }, "call-plan live tick failed");
    }
  }
}

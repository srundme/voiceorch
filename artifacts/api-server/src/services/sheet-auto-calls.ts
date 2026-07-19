/**
 * Automatic Calls from Google Sheets — pipeline CRUD, enqueue, poll.
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  agentsTable,
  campaignsTable,
  campaignLeadsTable,
  leadTimelineTable,
  googleSheetsConnectionsTable,
  sheetAutoCallPipelinesTable,
  sheetAutoCallRowStateTable,
  type SheetAutoColumnMap,
  type SheetAutoStartMode,
  type SheetAutoWritebackMode,
  type SheetAutoCallPipeline,
  type SheetAutoStatusColumns,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import {
  readSheetGrid,
  createSpreadsheet,
  ensureHeaders,
} from "./google-sheets.js";
import { scheduleCampaignCall } from "../orchestration/campaignCaller.js";
import { parseSheetLeadRow } from "./sheet-auto-calls-helpers.js";

export { parseSheetLeadRow } from "./sheet-auto-calls-helpers.js";

const DEFAULT_STATUS_COLS: SheetAutoStatusColumns = {
  status: "Status",
  lastCallAt: "Last Call At",
  disposition: "Disposition",
  summary: "Summary",
  callId: "Call ID",
  recording: "Recording",
};

export async function listPipelines(userId: string) {
  return db
    .select()
    .from(sheetAutoCallPipelinesTable)
    .where(eq(sheetAutoCallPipelinesTable.userId, userId))
    .orderBy(desc(sheetAutoCallPipelinesTable.createdAt));
}

export async function getPipeline(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(sheetAutoCallPipelinesTable)
    .where(and(
      eq(sheetAutoCallPipelinesTable.id, id),
      eq(sheetAutoCallPipelinesTable.userId, userId),
    ))
    .limit(1);
  return row ?? null;
}

export async function listPipelineActivity(userId: string, pipelineId: string, limit = 50) {
  const pipeline = await getPipeline(userId, pipelineId);
  if (!pipeline) return null;
  const rows = await db
    .select()
    .from(sheetAutoCallRowStateTable)
    .where(eq(sheetAutoCallRowStateTable.pipelineId, pipelineId))
    .orderBy(desc(sheetAutoCallRowStateTable.updatedAt))
    .limit(limit);
  return { pipeline, rows };
}

export type CreatePipelineInput = {
  name: string;
  connectionId: string;
  agentId: number;
  spreadsheetId: string;
  spreadsheetTitle?: string;
  sheetName: string;
  sheetGid?: number | null;
  columnMap: SheetAutoColumnMap;
  startMode: SheetAutoStartMode;
  writebackMode: SheetAutoWritebackMode;
  fromNumber?: string | null;
  concurrentCallLimit?: number;
  /** When writeback is call_log/both and user wants a new log sheet created. */
  createCallLogSheet?: boolean;
  callLogSpreadsheetId?: string | null;
  callLogSheetName?: string | null;
};

export async function createPipeline(userId: string, input: CreatePipelineInput) {
  if (!input.columnMap?.phone?.trim()) throw new Error("columnMap.phone is required");

  const [conn] = await db
    .select({ id: googleSheetsConnectionsTable.id })
    .from(googleSheetsConnectionsTable)
    .where(and(
      eq(googleSheetsConnectionsTable.id, input.connectionId),
      eq(googleSheetsConnectionsTable.userId, userId),
    ))
    .limit(1);
  if (!conn) throw new Error("Google Sheets connection not found");

  const [agent] = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, input.agentId), eq(agentsTable.userId, userId)))
    .limit(1);
  if (!agent) throw new Error("Agent not found");

  let callLogSpreadsheetId = input.callLogSpreadsheetId ?? null;
  let callLogSheetName = input.callLogSheetName ?? null;

  if (input.writebackMode === "call_log" || input.writebackMode === "both") {
    if (input.createCallLogSheet && !callLogSpreadsheetId) {
      const created = await createSpreadsheet(userId, input.connectionId, {
        title: `${input.name} — Call Log`,
        template: "call_log",
      });
      callLogSpreadsheetId = created.spreadsheetId;
      callLogSheetName = created.sheetName;
    } else if (callLogSpreadsheetId) {
      // Existing spreadsheet (or same file with explicit tab) — ensure call-log headers
      callLogSheetName = callLogSheetName || "Call Log";
      await ensureHeaders(userId, input.connectionId, callLogSpreadsheetId, callLogSheetName, [
        "Call ID", "Started At (IST)", "Duration (sec)", "Direction", "Phone",
        "Caller Name", "Disposition", "Summary", "Recording", "Agent", "Cost (₹)",
      ]);
    } else {
      // Default: same spreadsheet, Call Log tab
      callLogSpreadsheetId = input.spreadsheetId;
      callLogSheetName = callLogSheetName || "Call Log";
      await ensureHeaders(userId, input.connectionId, callLogSpreadsheetId, callLogSheetName, [
        "Call ID", "Started At (IST)", "Duration (sec)", "Direction", "Phone",
        "Caller Name", "Disposition", "Summary", "Recording", "Agent", "Cost (₹)",
      ]);
    }
  }

  if (input.writebackMode === "same_sheet" || input.writebackMode === "both") {
    const cols = Object.values(DEFAULT_STATUS_COLS).filter(Boolean) as string[];
    await ensureHeaders(userId, input.connectionId, input.spreadsheetId, input.sheetName, cols);
  }

  const [row] = await db.insert(sheetAutoCallPipelinesTable).values({
    userId,
    name: input.name.trim() || "Automatic Calls",
    connectionId: input.connectionId,
    agentId: input.agentId,
    spreadsheetId: input.spreadsheetId,
    spreadsheetTitle: input.spreadsheetTitle ?? null,
    sheetName: input.sheetName || "Sheet1",
    sheetGid: input.sheetGid ?? null,
    columnMap: input.columnMap,
    startMode: input.startMode,
    writebackMode: input.writebackMode,
    callLogSpreadsheetId,
    callLogSheetName,
    sameSheetStatusColumns: DEFAULT_STATUS_COLS,
    fromNumber: input.fromNumber ?? null,
    concurrentCallLimit: Math.min(Math.max(input.concurrentCallLimit ?? 5, 1), 20),
    status: "draft",
    cursorRowIndex: 1,
  }).returning();

  return row!;
}

async function ensureCampaign(pipeline: SheetAutoCallPipeline): Promise<number> {
  if (pipeline.campaignId) return pipeline.campaignId;

  const [campaign] = await db.insert(campaignsTable).values({
    userId: pipeline.userId,
    name: `[Auto] ${pipeline.name}`,
    description: `Automatic Calls pipeline ${pipeline.id}`,
    agentId: pipeline.agentId,
    fieldMappings: { phone: "phone", name: "name", email: "email" },
    fromNumber: pipeline.fromNumber,
    concurrentCallLimit: pipeline.concurrentCallLimit,
    callDelaySeconds: 3,
    maxAttempts: 1,
    leadSource: "google_sheets",
    triggerMode: "instant",
    webhookToken: randomUUID(),
    status: "active",
    isActive: true,
    // Match builder: dial anytime unless user configures hours on a normal campaign.
    isCallingHoursEnabled: false,
  }).returning();

  await db.update(sheetAutoCallPipelinesTable)
    .set({ campaignId: campaign!.id, updatedAt: new Date() })
    .where(eq(sheetAutoCallPipelinesTable.id, pipeline.id));

  return campaign!.id;
}

async function enqueueRow(
  pipeline: SheetAutoCallPipeline,
  campaignId: number,
  sheetRowIndex: number,
  parsed: ReturnType<typeof parseSheetLeadRow>,
): Promise<"enqueued" | "skipped" | "duplicate"> {
  if (!parsed.phoneNormalized) {
    await db.insert(sheetAutoCallRowStateTable).values({
      pipelineId: pipeline.id,
      sheetRowIndex,
      phoneNormalized: "",
      status: "skipped",
      error: "Invalid phone",
    }).onConflictDoNothing();
    return "skipped";
  }

  // Dedupe by row index
  const [existingRow] = await db
    .select({ id: sheetAutoCallRowStateTable.id, status: sheetAutoCallRowStateTable.status })
    .from(sheetAutoCallRowStateTable)
    .where(and(
      eq(sheetAutoCallRowStateTable.pipelineId, pipeline.id),
      eq(sheetAutoCallRowStateTable.sheetRowIndex, sheetRowIndex),
    ))
    .limit(1);
  if (existingRow) return "duplicate";

  // Dedupe by phone while an earlier attempt is still pending/dialing
  const [existingPhone] = await db
    .select({ id: sheetAutoCallRowStateTable.id, status: sheetAutoCallRowStateTable.status })
    .from(sheetAutoCallRowStateTable)
    .where(and(
      eq(sheetAutoCallRowStateTable.pipelineId, pipeline.id),
      eq(sheetAutoCallRowStateTable.phoneNormalized, parsed.phoneNormalized),
    ))
    .limit(1);
  if (existingPhone && ["pending", "enqueued", "dialing"].includes(existingPhone.status)) {
    await db.insert(sheetAutoCallRowStateTable).values({
      pipelineId: pipeline.id,
      sheetRowIndex,
      phoneNormalized: parsed.phoneNormalized,
      status: "skipped",
      error: "Duplicate phone already queued",
    }).onConflictDoNothing();
    return "duplicate";
  }

  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId)).limit(1);
  if (!campaign) throw new Error("Campaign missing");

  const leadData = {
    ...parsed.leadData,
    ...(parsed.name
      ? { name: parsed.name, customer_name: parsed.name, caller_name: parsed.name }
      : {}),
    __sheet_pipeline_id: pipeline.id,
    __sheet_row_index: String(sheetRowIndex),
  };

  const [lead] = await db.insert(campaignLeadsTable).values({
    campaignId,
    phone: parsed.phoneRaw || parsed.phoneNormalized,
    normalizedPhone: parsed.phoneNormalized,
    name: parsed.name || null,
    email: parsed.email || null,
    leadData,
    source: "google_sheets",
    externalLeadId: `sheet:${pipeline.id}:row:${sheetRowIndex}`,
    callStatus: "pending",
  }).returning();

  await db.insert(leadTimelineTable).values({
    leadId: lead!.id,
    campaignId,
    eventType: "imported",
    data: { source: "google_sheets", pipelineId: pipeline.id, sheetRowIndex },
  });

  await db.update(campaignsTable)
    .set({ totalLeads: sql`${campaignsTable.totalLeads} + 1` })
    .where(eq(campaignsTable.id, campaignId));

  await db.insert(sheetAutoCallRowStateTable).values({
    pipelineId: pipeline.id,
    sheetRowIndex,
    phoneNormalized: parsed.phoneNormalized,
    leadId: lead!.id,
    status: "enqueued",
  });

  await db.update(sheetAutoCallPipelinesTable)
    .set({
      enqueuedCount: sql`${sheetAutoCallPipelinesTable.enqueuedCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(sheetAutoCallPipelinesTable.id, pipeline.id));

  scheduleCampaignCall(lead!, campaign);
  return "enqueued";
}

/**
 * Process sheet rows for a pipeline. When `fromRowExclusive` is set, only rows
 * after that index (1-based header=1) are considered.
 */
export async function processSheetRows(
  pipeline: SheetAutoCallPipeline,
  opts: { fromRowExclusive: number; advanceCursor: boolean },
): Promise<{ enqueued: number; skipped: number; lastRow: number }> {
  const grid = await readSheetGrid(
    pipeline.userId,
    pipeline.connectionId,
    pipeline.spreadsheetId,
    pipeline.sheetName,
  );
  const { headers, rows } = grid;
  const lastRow = rows.length + 1; // 1-based last data row index (= header + length)
  const campaignId = await ensureCampaign(pipeline);

  let enqueued = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const sheetRowIndex = i + 2; // row 1 = header
    if (sheetRowIndex <= opts.fromRowExclusive) continue;
    const parsed = parseSheetLeadRow(headers, rows[i]!, pipeline.columnMap as SheetAutoColumnMap);
    const result = await enqueueRow(pipeline, campaignId, sheetRowIndex, parsed);
    if (result === "enqueued") enqueued += 1;
    else skipped += 1;
  }

  if (opts.advanceCursor) {
    await db.update(sheetAutoCallPipelinesTable)
      .set({
        cursorRowIndex: Math.max(pipeline.cursorRowIndex, lastRow),
        lastPolledAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(sheetAutoCallPipelinesTable.id, pipeline.id));
  }

  return { enqueued, skipped, lastRow };
}

export async function startPipeline(userId: string, id: string) {
  const pipeline = await getPipeline(userId, id);
  if (!pipeline) throw new Error("Pipeline not found");
  if (pipeline.status === "stopped") throw new Error("Pipeline is stopped");
  if (pipeline.status === "running") return pipeline;

  await ensureCampaign(pipeline);
  const fresh = (await getPipeline(userId, id))!;

  if (pipeline.startMode === "new_only") {
    // Set cursor to current last row so existing rows are ignored
    const grid = await readSheetGrid(
      fresh.userId, fresh.connectionId, fresh.spreadsheetId, fresh.sheetName,
    );
    const lastRow = grid.rows.length + 1;
    await db.update(sheetAutoCallPipelinesTable)
      .set({
        status: "running",
        cursorRowIndex: lastRow,
        lastPolledAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(sheetAutoCallPipelinesTable.id, id));
  } else {
    // Backfill existing rows, then watch
    await db.update(sheetAutoCallPipelinesTable)
      .set({ status: "running", lastError: null, updatedAt: new Date() })
      .where(eq(sheetAutoCallPipelinesTable.id, id));
    const running = (await getPipeline(userId, id))!;
    await processSheetRows(running, { fromRowExclusive: 1, advanceCursor: true });
  }

  // Ensure linked campaign is active
  if (fresh.campaignId) {
    await db.update(campaignsTable)
      .set({ status: "active", isActive: true })
      .where(eq(campaignsTable.id, fresh.campaignId));
  }

  return getPipeline(userId, id);
}

export async function pausePipeline(userId: string, id: string) {
  const pipeline = await getPipeline(userId, id);
  if (!pipeline) throw new Error("Pipeline not found");
  await db.update(sheetAutoCallPipelinesTable)
    .set({ status: "paused", updatedAt: new Date() })
    .where(eq(sheetAutoCallPipelinesTable.id, id));
  if (pipeline.campaignId) {
    await db.update(campaignsTable)
      .set({ status: "paused", isActive: false })
      .where(eq(campaignsTable.id, pipeline.campaignId));
  }
  return getPipeline(userId, id);
}

export async function resumePipeline(userId: string, id: string) {
  const pipeline = await getPipeline(userId, id);
  if (!pipeline) throw new Error("Pipeline not found");
  if (pipeline.status === "stopped") throw new Error("Pipeline is stopped");
  await db.update(sheetAutoCallPipelinesTable)
    .set({ status: "running", lastError: null, updatedAt: new Date() })
    .where(eq(sheetAutoCallPipelinesTable.id, id));
  if (pipeline.campaignId) {
    await db.update(campaignsTable)
      .set({ status: "active", isActive: true })
      .where(eq(campaignsTable.id, pipeline.campaignId));
  }
  return getPipeline(userId, id);
}

export async function stopPipeline(userId: string, id: string) {
  const pipeline = await getPipeline(userId, id);
  if (!pipeline) throw new Error("Pipeline not found");
  await db.update(sheetAutoCallPipelinesTable)
    .set({ status: "stopped", updatedAt: new Date() })
    .where(eq(sheetAutoCallPipelinesTable.id, id));
  if (pipeline.campaignId) {
    await db.update(campaignsTable)
      .set({ status: "completed", isActive: false })
      .where(eq(campaignsTable.id, pipeline.campaignId));
  }
  return getPipeline(userId, id);
}

/** Re-fire dials for leads still pending after a lost setTimeout / TRAI deferral. */
async function requeuePendingDials(pipeline: SheetAutoCallPipeline): Promise<number> {
  if (!pipeline.campaignId) return 0;

  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, pipeline.campaignId))
    .limit(1);
  if (!campaign || !campaign.isActive) return 0;

  // Recover dials that failed only because from-number was missing (pre-fix),
  // and TRAI outside-hours skips that should stay retryable.
  await db.execute(sql`
    UPDATE campaign_leads cl
    SET call_status = 'pending',
        call_attempts = CASE
          WHEN cl.notes ILIKE '%fromNumber%'
            OR cl.notes ILIKE '%from-number%'
            OR cl.notes ILIKE '%No outbound from-number%'
          THEN 0 ELSE cl.call_attempts END,
        notes = CASE
          WHEN cl.notes ILIKE '%Outside permitted calling hours%' THEN cl.notes
          ELSE null END
    FROM sheet_auto_call_row_state rs
    WHERE rs.lead_id = cl.id
      AND rs.pipeline_id = ${pipeline.id}::uuid
      AND cl.call_status IN ('failed', 'skipped')
      AND (
        cl.notes ILIKE '%fromNumber%'
        OR cl.notes ILIKE '%from-number%'
        OR cl.notes ILIKE '%No outbound from-number%'
        OR cl.notes ILIKE '%Outside permitted calling hours%'
      )
  `);
  await db.execute(sql`
    UPDATE sheet_auto_call_row_state rs
    SET status = 'enqueued',
        error = CASE
          WHEN cl.notes ILIKE '%Outside permitted calling hours%'
          THEN 'Waiting for calling hours (9 AM–9 PM IST)'
          ELSE null END,
        updated_at = now()
    FROM campaign_leads cl
    WHERE rs.lead_id = cl.id
      AND rs.pipeline_id = ${pipeline.id}::uuid
      AND cl.call_status = 'pending'
      AND rs.status IN ('failed', 'skipped')
  `);

  const stuck = await db
    .select({
      lead: campaignLeadsTable,
    })
    .from(sheetAutoCallRowStateTable)
    .innerJoin(
      campaignLeadsTable,
      eq(sheetAutoCallRowStateTable.leadId, campaignLeadsTable.id),
    )
    .where(and(
      eq(sheetAutoCallRowStateTable.pipelineId, pipeline.id),
      eq(sheetAutoCallRowStateTable.status, "enqueued"),
      eq(campaignLeadsTable.callStatus, "pending"),
    ))
    .limit(20);

  for (const row of stuck) {
    scheduleCampaignCall(row.lead, campaign);
  }
  return stuck.length;
}

/** One poll tick for a running pipeline — enqueue rows after cursor. */
export async function pollOnce(pipelineId: string): Promise<void> {
  const [pipeline] = await db
    .select()
    .from(sheetAutoCallPipelinesTable)
    .where(and(
      eq(sheetAutoCallPipelinesTable.id, pipelineId),
      eq(sheetAutoCallPipelinesTable.status, "running"),
    ))
    .limit(1);
  if (!pipeline) return;

  try {
    const result = await processSheetRows(pipeline, {
      fromRowExclusive: pipeline.cursorRowIndex,
      advanceCursor: true,
    });
    if (result.enqueued > 0) {
      logger.info(
        { pipelineId, enqueued: result.enqueued, lastRow: result.lastRow },
        "sheet-auto-call: poll enqueued leads",
      );
    }
    const requeued = await requeuePendingDials(pipeline);
    if (requeued > 0) {
      logger.info({ pipelineId, requeued }, "sheet-auto-call: requeued pending dials");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, pipelineId }, "sheet-auto-call: poll failed");
    await db.update(sheetAutoCallPipelinesTable)
      .set({
        lastError: msg.slice(0, 500),
        lastPolledAt: new Date(),
        // Pause on auth/permission failures so we don't spam
        ...( /auth|permission|403|401|not found/i.test(msg) ? { status: "paused" as const } : {}),
        updatedAt: new Date(),
      })
      .where(eq(sheetAutoCallPipelinesTable.id, pipelineId));
  }
}

const POLL_INTERVAL_MS = 30_000;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const pollingLock = new Set<string>();

export function startSheetAutoCallPoller(): void {
  if (pollTimer) return;
  logger.info("sheet-auto-call: poller started (30s)");
  pollTimer = setInterval(() => {
    void (async () => {
      try {
        const running = await db
          .select({ id: sheetAutoCallPipelinesTable.id })
          .from(sheetAutoCallPipelinesTable)
          .where(eq(sheetAutoCallPipelinesTable.status, "running"));
        for (const p of running) {
          if (pollingLock.has(p.id)) continue;
          pollingLock.add(p.id);
          try {
            await pollOnce(p.id);
          } finally {
            pollingLock.delete(p.id);
          }
        }
      } catch (err) {
        logger.warn({ err }, "sheet-auto-call: poller tick failed");
      }
    })();
  }, POLL_INTERVAL_MS);
  // Unref so it doesn't keep process alive alone in tests
  if (typeof pollTimer === "object" && "unref" in pollTimer) {
    (pollTimer as NodeJS.Timeout).unref?.();
  }
}

export function stopSheetAutoCallPoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * Google Sheets post-call writeback + session-start lookup orchestration.
 * Fire-and-forget from endSession / PATCH /calls/:id/end — never blocks hangup.
 */

import { and, eq, isNull, desc, sql } from "drizzle-orm";
import {
  db,
  callsTable,
  agentsTable,
  campaignLeadsTable,
  callerProfilesTable,
  callerFactsTable,
  sheetAutoCallPipelinesTable,
  sheetAutoCallRowStateTable,
  canonicalizeCallerKey,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { toAbsoluteAppUrl } from "../lib/app-domain.js";
import {
  listEnabledBindings,
  appendCallLogRow,
  updateOutcomeRow,
  updateSheetRowByIndex,
  runLookupBindings,
} from "./google-sheets.js";

/** Prefer stored recording path; always write a full URL into Sheets. */
function sheetRecordingUrl(call: { id: number; recordingUrl: string | null }): string {
  const stored = (call.recordingUrl ?? "").trim();
  const path = stored || `/api/storage/recordings/${call.id}`;
  return toAbsoluteAppUrl(path);
}

function formatIst(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDisposition(disp: unknown): string {
  if (disp == null) return "";
  if (typeof disp === "string") return disp;
  if (typeof disp === "object") {
    try {
      const obj = disp as Record<string, unknown>;
      const preferred = ["outcome", "status", "disposition", "result", "intent"];
      for (const k of preferred) {
        const v = obj[k];
        if (v != null && String(v).trim()) return String(v);
      }
      return JSON.stringify(disp);
    } catch {
      return String(disp);
    }
  }
  return String(disp);
}

function resolveCallPhone(call: {
  fromNumber: string;
  toNumber: string;
  metadata: string | null;
}): { phone: string; direction: string } {
  let direction = "inbound";
  try {
    const meta = call.metadata ? JSON.parse(call.metadata) as Record<string, unknown> : {};
    if (typeof meta["direction"] === "string") direction = meta["direction"];
  } catch { /* ignore */ }
  const phone = direction === "outbound" ? call.toNumber : call.fromNumber;
  return { phone, direction };
}

function formatCostInr(costCents: number | null | undefined): string {
  if (costCents == null || costCents <= 0) return "";
  return (costCents / 100).toFixed(2);
}

function nameFromDisposition(disp: unknown): string {
  if (!disp || typeof disp !== "object") return "";
  const obj = disp as Record<string, unknown>;
  for (const k of ["name", "caller_name", "customer_name", "contact_name", "full_name"]) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * Resolve human name for sheet writeback.
 * Prefer campaign lead → caller memory profile → name fact → disposition.
 */
async function resolveCallerIdentity(
  callId: number,
  agentId: number,
  phone: string,
  disposition?: Record<string, unknown> | null,
): Promise<{ name: string; email: string }> {
  let name = "";
  let email = "";

  try {
    const [lead] = await db
      .select({
        name: campaignLeadsTable.name,
        email: campaignLeadsTable.email,
        leadData: campaignLeadsTable.leadData,
      })
      .from(campaignLeadsTable)
      .where(eq(campaignLeadsTable.callId, callId))
      .limit(1);
    if (lead) {
      if (lead.name?.trim()) name = lead.name.trim();
      if (lead.email?.trim()) email = lead.email.trim();
      const ld = (lead.leadData ?? {}) as Record<string, unknown>;
      if (!name && typeof ld["name"] === "string" && ld["name"].trim()) name = ld["name"].trim();
      if (!email && typeof ld["email"] === "string" && ld["email"].trim()) email = ld["email"].trim();
    }
  } catch (err) {
    logger.warn({ err, callId }, "sheets: campaign lead lookup failed");
  }

  if (!name && phone.trim()) {
    try {
      const key = canonicalizeCallerKey(phone) ?? phone;
      const [profile] = await db
        .select({ name: callerProfilesTable.name })
        .from(callerProfilesTable)
        .where(and(
          eq(callerProfilesTable.agentId, agentId),
          eq(callerProfilesTable.phoneNumber, key),
        ))
        .limit(1);
      if (profile?.name?.trim()) name = profile.name.trim();

      if (!name) {
        const [fact] = await db
          .select({ value: callerFactsTable.value })
          .from(callerFactsTable)
          .where(and(
            eq(callerFactsTable.agentId, agentId),
            eq(callerFactsTable.phoneNumber, key),
            eq(callerFactsTable.key, "name"),
            isNull(callerFactsTable.supersededById),
          ))
          .orderBy(desc(callerFactsTable.createdAt))
          .limit(1);
        if (fact?.value?.trim()) name = fact.value.trim();
      }
    } catch (err) {
      logger.warn({ err, callId, agentId }, "sheets: caller memory name lookup failed");
    }
  }

  if (!name) name = nameFromDisposition(disposition);

  return { name, email };
}

/** Session-start: merge sheet row fields for enabled lookup bindings. */
export async function lookupSheetsCallerContext(
  userId: string,
  agentId: number,
  phone: string,
): Promise<Record<string, string>> {
  if (!userId || !phone?.trim()) return {};
  try {
    return await runLookupBindings(userId, agentId, phone);
  } catch (err) {
    logger.warn({ err, agentId, userId }, "sheets: session lookup failed");
    return {};
  }
}

/** Append a row to each enabled call_log binding for this agent. */
export async function writeSheetsCallLog(
  callId: number,
  opts?: {
    callSummary?: string | null;
    dispositionResult?: Record<string, unknown> | null;
  },
): Promise<void> {
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, callId)).limit(1);
  if (!call?.userId) return;

  const [agent] = await db
    .select({ id: agentsTable.id, name: agentsTable.name })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, call.agentId), eq(agentsTable.userId, call.userId)))
    .limit(1);
  if (!agent) return;

  const bindings = await listEnabledBindings(call.userId, call.agentId, "call_log");
  if (bindings.length === 0) return;

  const { phone, direction } = resolveCallPhone(call);
  const disposition = opts?.dispositionResult ?? call.dispositionResult ?? null;
  const identity = await resolveCallerIdentity(callId, call.agentId, phone, disposition);

  const fields: Record<string, string | number | null | undefined> = {
    callId: call.id,
    startedAt: formatIst(call.createdAt),
    durationSeconds: call.durationSeconds ?? 0,
    direction,
    phone,
    callerName: identity.name,
    disposition: formatDisposition(disposition),
    summary: opts?.callSummary ?? call.callSummary ?? "",
    recordingUrl: sheetRecordingUrl(call),
    agentName: agent.name,
    costCents: formatCostInr(call.costCents),
  };

  for (const b of bindings) {
    try {
      await appendCallLogRow(
        call.userId,
        b.connectionId,
        b.spreadsheetId,
        b.sheetName,
        fields,
        b.columnMap,
      );
      logger.info({ callId, bindingId: b.id }, "sheets: call_log append ok");
    } catch (err) {
      logger.warn({ err, callId, bindingId: b.id }, "sheets: call_log append failed");
    }
  }
}

/**
 * Upsert outcome/pipeline rows after summary + disposition are available.
 * Creates a row when the phone is not found yet.
 */
export async function writeSheetsOutcome(
  callId: number,
  opts?: {
    callSummary?: string | null;
    dispositionResult?: Record<string, unknown> | null;
  },
): Promise<void> {
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, callId)).limit(1);
  if (!call?.userId) return;

  const bindings = await listEnabledBindings(call.userId, call.agentId, "outcome");
  if (bindings.length === 0) return;

  const { phone } = resolveCallPhone(call);
  if (!phone?.trim()) return;

  const summary = opts?.callSummary ?? call.callSummary ?? "";
  const dispositionRaw = opts?.dispositionResult ?? call.dispositionResult ?? null;
  const disposition = formatDisposition(dispositionRaw);
  const status = disposition || call.status || "completed";
  const identity = await resolveCallerIdentity(callId, call.agentId, phone, dispositionRaw);

  const fields: Record<string, string | number | null | undefined> = {
    phone,
    name: identity.name,
    email: identity.email,
    status,
    lastCallAt: formatIst(call.endedAt ?? new Date()),
    disposition,
    notes: summary,
    nextFollowUp: "",
  };

  for (const b of bindings) {
    try {
      const matchCol = b.matchColumn?.trim() || "Phone";
      const result = await updateOutcomeRow(
        call.userId,
        b.connectionId,
        b.spreadsheetId,
        b.sheetName,
        matchCol,
        phone,
        fields,
        { columnMap: b.columnMap, createIfMissing: true },
      );
      logger.info(
        { callId, bindingId: b.id, created: result?.created ?? false, rowIndex: result?.rowIndex },
        "sheets: outcome write ok",
      );
    } catch (err) {
      logger.warn({ err, callId, bindingId: b.id }, "sheets: outcome write failed");
    }
  }
}

/**
 * Automatic Calls pipeline writeback — same-sheet row update and/or call log append.
 * Resolves pipeline via campaign lead metadata `__sheet_pipeline_id`.
 */
export async function writeSheetAutoCallResults(
  callId: number,
  opts?: {
    callSummary?: string | null;
    dispositionResult?: Record<string, unknown> | null;
  },
): Promise<void> {
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, callId)).limit(1);
  if (!call?.userId) return;

  let lead = (await db
    .select()
    .from(campaignLeadsTable)
    .where(eq(campaignLeadsTable.callId, callId))
    .limit(1))[0] ?? null;

  // Fallback: row state already linked to this call
  if (!lead) {
    const [rs] = await db
      .select()
      .from(sheetAutoCallRowStateTable)
      .where(eq(sheetAutoCallRowStateTable.callId, callId))
      .limit(1);
    if (rs?.leadId) {
      lead = (await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.id, rs.leadId)).limit(1))[0] ?? null;
    }
  }

  if (!lead) return;
  const ld = (lead.leadData ?? {}) as Record<string, string>;
  const pipelineId = ld["__sheet_pipeline_id"];
  if (!pipelineId) return;
  const ri = Number(ld["__sheet_row_index"]);
  const sheetRowIndex = Number.isFinite(ri) && ri >= 2 ? ri : null;

  const [pipeline] = await db
    .select()
    .from(sheetAutoCallPipelinesTable)
    .where(and(
      eq(sheetAutoCallPipelinesTable.id, pipelineId),
      eq(sheetAutoCallPipelinesTable.userId, call.userId),
    ))
    .limit(1);
  if (!pipeline) return;

  const { phone, direction } = resolveCallPhone(call);
  const summary = opts?.callSummary ?? call.callSummary ?? "";
  const disposition = formatDisposition(opts?.dispositionResult ?? call.dispositionResult);
  const status = call.status || "completed";
  const identity = await resolveCallerIdentity(
    callId, call.agentId, phone, opts?.dispositionResult ?? call.dispositionResult,
  );

  const [agent] = await db
    .select({ name: agentsTable.name })
    .from(agentsTable)
    .where(eq(agentsTable.id, call.agentId))
    .limit(1);

  if (sheetRowIndex != null) {
    await db.update(sheetAutoCallRowStateTable)
      .set({
        callId,
        leadId: lead.id,
        status: status === "failed" || status === "error" ? "failed" : "completed",
        updatedAt: new Date(),
      })
      .where(and(
        eq(sheetAutoCallRowStateTable.pipelineId, pipelineId),
        eq(sheetAutoCallRowStateTable.sheetRowIndex, sheetRowIndex),
      ));
  }

  const mode = pipeline.writebackMode;
  const cols = (pipeline.sameSheetStatusColumns ?? {}) as Record<string, string | undefined>;

  if ((mode === "same_sheet" || mode === "both") && sheetRowIndex != null) {
    try {
      const updates: Record<string, string> = {};
      if (cols.status) updates[cols.status] = status;
      if (cols.lastCallAt) updates[cols.lastCallAt] = formatIst(call.endedAt ?? new Date());
      if (cols.disposition) updates[cols.disposition] = disposition;
      if (cols.summary) updates[cols.summary] = summary;
      if (cols.callId) updates[cols.callId] = String(call.id);
      if (cols.recording) updates[cols.recording] = sheetRecordingUrl(call);
      await updateSheetRowByIndex(
        call.userId,
        pipeline.connectionId,
        pipeline.spreadsheetId,
        pipeline.sheetName,
        sheetRowIndex,
        updates,
      );
      logger.info({ callId, pipelineId, sheetRowIndex }, "sheet-auto-call: same-sheet write ok");
    } catch (err) {
      logger.warn({ err, callId, pipelineId }, "sheet-auto-call: same-sheet write failed");
    }
  }

  if ((mode === "call_log" || mode === "both") && pipeline.callLogSpreadsheetId) {
    try {
      await appendCallLogRow(
        call.userId,
        pipeline.connectionId,
        pipeline.callLogSpreadsheetId,
        pipeline.callLogSheetName || "Call Log",
        {
          callId: call.id,
          startedAt: formatIst(call.createdAt),
          durationSeconds: call.durationSeconds ?? 0,
          direction,
          phone,
          callerName: identity.name || lead.name || "",
          disposition,
          summary,
          recordingUrl: sheetRecordingUrl(call),
          agentName: agent?.name ?? "",
          costCents: call.costCents != null && call.costCents > 0 ? (call.costCents / 100).toFixed(2) : "",
        },
      );
      logger.info({ callId, pipelineId }, "sheet-auto-call: call_log append ok");
    } catch (err) {
      logger.warn({ err, callId, pipelineId }, "sheet-auto-call: call_log append failed");
    }
  }

  const isFail = status === "failed" || status === "error";
  if (isFail) {
    await db.update(sheetAutoCallPipelinesTable)
      .set({
        failedCount: sql`${sheetAutoCallPipelinesTable.failedCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(sheetAutoCallPipelinesTable.id, pipelineId));
  }
}

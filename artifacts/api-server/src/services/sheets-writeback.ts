/**
 * Google Sheets post-call writeback + session-start lookup orchestration.
 * Fire-and-forget from endSession / PATCH /calls/:id/end — never blocks hangup.
 */

import { and, eq, isNull, desc, sql, ne } from "drizzle-orm";
import {
  db,
  callsTable,
  agentsTable,
  campaignLeadsTable,
  callerProfilesTable,
  callerFactsTable,
  sheetAutoCallPipelinesTable,
  sheetAutoCallRowStateTable,
  scheduledCallbacksTable,
  bookingsTable,
  canonicalizeCallerKey,
  type SheetAutoCallPipeline,
  type SheetAutoStatusColumns,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { toAbsoluteAppUrl } from "../lib/app-domain.js";
import { shareableRecordingUrl } from "./recording-share.js";
import { friendlySheetStatus } from "./sheet-auto-calls-helpers.js";
import {
  listEnabledBindings,
  appendCallLogRow,
  updateOutcomeRow,
  updateSheetRowByIndex,
  runLookupBindings,
  lookupRowByPhone,
  ensureHeaders,
} from "./google-sheets.js";
import {
  isCallbackDisposition,
  isBookedDisposition,
  defaultNextDayCallbackAt,
  extractExplicitCallbackAt,
  formatSheetIst,
} from "./sheet-auto-call-loops.js";
import { phonesMatch, rowToPromptVars } from "./google-sheets-helpers.js";

/** Prefer shareable link for Sheets; fall back to absolute auth URL. */
function sheetRecordingUrl(call: { id: number; recordingUrl: string | null }): string {
  try {
    return shareableRecordingUrl(call.id);
  } catch {
    const stored = (call.recordingUrl ?? "").trim();
    const path = stored || `/api/storage/recordings/${call.id}`;
    return toAbsoluteAppUrl(path);
  }
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

function parseCallSheetMeta(metadata: string | null | undefined): {
  pipelineId: string | null;
  sheetRowIndex: number | null;
} {
  try {
    const meta = metadata ? JSON.parse(metadata) as Record<string, unknown> : {};
    const pipelineId =
      typeof meta["__sheet_pipeline_id"] === "string" ? meta["__sheet_pipeline_id"] : null;
    const ri = Number(meta["__sheet_row_index"]);
    const sheetRowIndex = Number.isFinite(ri) && ri >= 2 ? ri : null;
    return { pipelineId, sheetRowIndex };
  } catch {
    return { pipelineId: null, sheetRowIndex: null };
  }
}

function statusColumnMap(pipeline: SheetAutoCallPipeline): SheetAutoStatusColumns {
  const cols = (pipeline.sameSheetStatusColumns ?? {}) as SheetAutoStatusColumns;
  return {
    status: cols.status || "Status",
    lastCallAt: cols.lastCallAt || "Last Call At",
    disposition: cols.disposition || "Disposition",
    summary: cols.summary || "Summary",
    callId: cols.callId || "Call ID",
    recording: cols.recording || "Recording",
    nextFollowUp: cols.nextFollowUp || "Next Follow-up",
    meetingTime: cols.meetingTime || "Meeting Time",
  };
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

export type SheetSessionLookup = {
  vars: Record<string, string>;
  pipelineId?: string;
  sheetRowIndex?: number;
};

/**
 * Phone match against Automatic Calls pipelines for this user.
 * Prefer same-agent running/paused, then same-agent other non-stopped, then any user pipeline.
 */
export async function lookupSheetAutoCallPipelines(
  userId: string,
  agentId: number,
  phone: string,
): Promise<SheetSessionLookup | null> {
  if (!userId || !phone?.trim()) return null;

  const pipelines = await db
    .select()
    .from(sheetAutoCallPipelinesTable)
    .where(and(
      eq(sheetAutoCallPipelinesTable.userId, userId),
      ne(sheetAutoCallPipelinesTable.status, "stopped"),
    ));

  if (pipelines.length === 0) return null;

  const rank = (p: SheetAutoCallPipeline): number => {
    const sameAgent = p.agentId === agentId;
    const active = p.status === "running" || p.status === "paused";
    if (sameAgent && active) return 0;
    if (sameAgent) return 1;
    if (active) return 2;
    return 3;
  };

  const ordered = [...pipelines].sort((a, b) => rank(a) - rank(b));

  for (const pipeline of ordered) {
    const matchCol = (pipeline.columnMap as { phone?: string })?.phone?.trim() || "Phone";
    try {
      const hit = await lookupRowByPhone(
        userId,
        pipeline.connectionId,
        pipeline.spreadsheetId,
        pipeline.sheetName,
        matchCol,
        phone,
      );
      if (!hit) continue;
      const vars = rowToPromptVars(hit.values);
      logger.info(
        {
          userId,
          agentId,
          pipelineId: pipeline.id,
          sheetRowIndex: hit.rowIndex,
          fields: Object.keys(vars).length,
        },
        "sheet-auto-call: inbound phone lookup hit",
      );
      return {
        vars,
        pipelineId: pipeline.id,
        sheetRowIndex: hit.rowIndex,
      };
    } catch (err) {
      logger.warn(
        { err, pipelineId: pipeline.id, userId, agentId },
        "sheet-auto-call: inbound lookup failed for pipeline",
      );
    }
  }
  return null;
}

/**
 * Session-start lookup: legacy agent bindings first, else Automatic Calls pipelines.
 */
export async function lookupSheetsForSession(
  userId: string,
  agentId: number,
  phone: string,
): Promise<SheetSessionLookup> {
  if (!userId || !phone?.trim()) return { vars: {} };
  try {
    const bindingVars = await runLookupBindings(userId, agentId, phone);
    if (Object.keys(bindingVars).length > 0) {
      return { vars: bindingVars };
    }
  } catch (err) {
    logger.warn({ err, agentId, userId }, "sheets: binding lookup failed");
  }

  try {
    const pipelineHit = await lookupSheetAutoCallPipelines(userId, agentId, phone);
    if (pipelineHit) return pipelineHit;
  } catch (err) {
    logger.warn({ err, agentId, userId }, "sheets: pipeline lookup failed");
  }
  return { vars: {} };
}

export async function sheetKeysForLead(
  userId: string,
  agentId: number | null | undefined,
  phone: string,
): Promise<{ __sheet_pipeline_id?: string; __sheet_row_index?: string }> {
  if (!userId || !agentId || !phone?.trim()) return {};
  try {
    const hit = await lookupSheetAutoCallPipelines(userId, agentId, phone);
    if (!hit?.pipelineId || hit.sheetRowIndex == null) return {};
    return {
      __sheet_pipeline_id: hit.pipelineId,
      __sheet_row_index: String(hit.sheetRowIndex),
    };
  } catch (err) {
    logger.warn({ err, userId, agentId }, "sheets: stamp pipeline keys failed");
    return {};
  }
}

/** @deprecated Prefer lookupSheetsForSession — returns vars only for older callers. */
export async function lookupSheetsCallerContext(
  userId: string,
  agentId: number,
  phone: string,
): Promise<Record<string, string>> {
  const result = await lookupSheetsForSession(userId, agentId, phone);
  return result.vars;
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
    startedAt: formatSheetIst(call.createdAt),
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
    lastCallAt: formatSheetIst(call.endedAt ?? new Date()),
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

type ResolvedSheetTarget = {
  pipeline: SheetAutoCallPipeline;
  sheetRowIndex: number | null;
  lead: typeof campaignLeadsTable.$inferSelect | null;
  phone: string;
  direction: string;
};

/**
 * Resolve pipeline + row via campaign lead meta, row-state, or call metadata (inbound).
 */
async function resolveSheetAutoCallTarget(
  callId: number,
  opts?: { pipelineId?: string; sheetRowIndex?: number },
): Promise<ResolvedSheetTarget | null> {
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, callId)).limit(1);
  if (!call?.userId) return null;

  const { phone, direction } = resolveCallPhone(call);

  let lead = (await db
    .select()
    .from(campaignLeadsTable)
    .where(eq(campaignLeadsTable.callId, callId))
    .limit(1))[0] ?? null;

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

  let pipelineId: string | null = opts?.pipelineId ?? null;
  let sheetRowIndex: number | null =
    opts?.sheetRowIndex != null && opts.sheetRowIndex >= 2 ? opts.sheetRowIndex : null;

  if (lead) {
    const ld = (lead.leadData ?? {}) as Record<string, string>;
    if (!pipelineId) pipelineId = ld["__sheet_pipeline_id"] ?? null;
    if (sheetRowIndex == null) {
      const ri = Number(ld["__sheet_row_index"]);
      if (Number.isFinite(ri) && ri >= 2) sheetRowIndex = ri;
    }
  }

  if (!pipelineId || sheetRowIndex == null) {
    const fromMeta = parseCallSheetMeta(call.metadata);
    if (!pipelineId) pipelineId = fromMeta.pipelineId;
    if (sheetRowIndex == null) sheetRowIndex = fromMeta.sheetRowIndex;
  }

  if (!pipelineId) return null;

  const [pipeline] = await db
    .select()
    .from(sheetAutoCallPipelinesTable)
    .where(and(
      eq(sheetAutoCallPipelinesTable.id, pipelineId),
      eq(sheetAutoCallPipelinesTable.userId, call.userId),
    ))
    .limit(1);
  if (!pipeline) return null;

  return { pipeline, sheetRowIndex, lead, phone, direction };
}

async function hasPendingCallback(
  agentId: number,
  phone: string,
  campaignLeadId?: number | null,
): Promise<boolean> {
  if (campaignLeadId) {
    const [byLead] = await db
      .select({ id: scheduledCallbacksTable.id })
      .from(scheduledCallbacksTable)
      .where(and(
        eq(scheduledCallbacksTable.campaignLeadId, campaignLeadId),
        eq(scheduledCallbacksTable.status, "pending"),
      ))
      .limit(1);
    if (byLead) return true;
  }

  const pending = await db
    .select({ toNumber: scheduledCallbacksTable.toNumber })
    .from(scheduledCallbacksTable)
    .where(and(
      eq(scheduledCallbacksTable.agentId, agentId),
      eq(scheduledCallbacksTable.status, "pending"),
    ))
    .limit(100);
  return pending.some((r) => phonesMatch(r.toNumber, phone));
}

async function scheduleSheetCallback(opts: {
  callId: number;
  agentId: number;
  userId: string;
  phone: string;
  campaignLeadId: number | null;
  dispositionText: string;
  dispositionRaw: unknown;
}): Promise<Date | null> {
  const already = await hasPendingCallback(opts.agentId, opts.phone, opts.campaignLeadId);
  if (already) {
    logger.info({ callId: opts.callId, phone: opts.phone }, "sheet-auto-call: skip callback — pending exists");
    return null;
  }

  const scheduledAt =
    extractExplicitCallbackAt(opts.dispositionRaw) ?? defaultNextDayCallbackAt();

  try {
    await db.insert(scheduledCallbacksTable).values({
      agentId: opts.agentId,
      userId: opts.userId,
      toNumber: opts.phone,
      scheduledAt,
      createdFromCallId: opts.callId,
      campaignLeadId: opts.campaignLeadId,
      reason: "callback_requested",
      notes: opts.dispositionText
        ? `sheet_auto_call_callback: ${opts.dispositionText.slice(0, 480)}`
        : "sheet_auto_call_callback",
    });
    logger.info(
      { callId: opts.callId, scheduledAt, phone: opts.phone },
      "sheet-auto-call: callback scheduled",
    );
    return scheduledAt;
  } catch (err) {
    logger.warn({ err, callId: opts.callId }, "sheet-auto-call: callback schedule failed");
    return null;
  }
}

/**
 * Write Meeting Time + Status Booked onto the sheet row for a sheet-linked call.
 */
export async function writeSheetBookingForCall(
  callId: number,
  opts: { slotStart: Date | string; meetLink?: string | null },
): Promise<void> {
  try {
    const target = await resolveSheetAutoCallTarget(callId);
    if (!target || target.sheetRowIndex == null) return;
    if (target.pipeline.writebackMode === "call_log") return;

    const cols = statusColumnMap(target.pipeline);
    const [call] = await db.select().from(callsTable).where(eq(callsTable.id, callId)).limit(1);
    if (!call?.userId) return;

    const headers = [cols.status!, cols.meetingTime!].filter(Boolean);
    await ensureHeaders(
      call.userId,
      target.pipeline.connectionId,
      target.pipeline.spreadsheetId,
      target.pipeline.sheetName,
      headers,
    );

    const updates: Record<string, string> = {};
    if (cols.status) updates[cols.status] = "Booked";
    if (cols.meetingTime) updates[cols.meetingTime] = formatSheetIst(opts.slotStart);

    await updateSheetRowByIndex(
      call.userId,
      target.pipeline.connectionId,
      target.pipeline.spreadsheetId,
      target.pipeline.sheetName,
      target.sheetRowIndex,
      updates,
    );
    logger.info(
      { callId, pipelineId: target.pipeline.id, sheetRowIndex: target.sheetRowIndex },
      "sheet-auto-call: booking writeback ok",
    );
  } catch (err) {
    logger.warn({ err, callId }, "sheet-auto-call: booking writeback failed");
  }
}

/**
 * Automatic Calls pipeline writeback — same-sheet row update and/or call log append.
 * Resolves pipeline via campaign lead metadata or inbound call metadata.
 */
export async function writeSheetAutoCallResults(
  callId: number,
  opts?: {
    callSummary?: string | null;
    dispositionResult?: Record<string, unknown> | null;
    pipelineId?: string;
    sheetRowIndex?: number;
  },
): Promise<void> {
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, callId)).limit(1);
  if (!call?.userId) return;

  const target = await resolveSheetAutoCallTarget(callId, {
    pipelineId: opts?.pipelineId,
    sheetRowIndex: opts?.sheetRowIndex,
  });
  if (!target) return;

  const { pipeline, sheetRowIndex, lead, phone, direction } = target;
  const pipelineId = pipeline.id;

  const summary = opts?.callSummary ?? call.callSummary ?? "";
  const dispositionRaw = opts?.dispositionResult ?? call.dispositionResult ?? null;
  const disposition = formatDisposition(dispositionRaw);
  const status = call.status || "completed";
  const identity = await resolveCallerIdentity(callId, call.agentId, phone, dispositionRaw);

  const [agent] = await db
    .select({ name: agentsTable.name })
    .from(agentsTable)
    .where(eq(agentsTable.id, call.agentId))
    .limit(1);

  if (sheetRowIndex != null && lead) {
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
  const cols = statusColumnMap(pipeline);

  let sheetStatusLabel = friendlySheetStatus(status);
  let nextFollowUpValue = "";

  const bookedHit = isBookedDisposition(
    disposition,
    summary,
    typeof dispositionRaw === "object" && dispositionRaw
      ? String((dispositionRaw as Record<string, unknown>)["status"] ?? "")
      : "",
    typeof dispositionRaw === "object" && dispositionRaw
      ? String((dispositionRaw as Record<string, unknown>)["primary"] ?? "")
      : "",
    sheetStatusLabel,
  );
  if (bookedHit && sheetStatusLabel === "Completed") {
    sheetStatusLabel = "Booked";
  }
  if (sheetStatusLabel === "Completed") {
    try {
      const [booking] = await db
        .select({ id: bookingsTable.id })
        .from(bookingsTable)
        .where(and(eq(bookingsTable.callId, callId), ne(bookingsTable.status, "cancelled")))
        .limit(1);
      if (booking) sheetStatusLabel = "Booked";
    } catch (err) {
      logger.warn({ err, callId }, "sheet-auto-call: booking lookup for status preserve failed");
    }
  }

  const callbackHit = isCallbackDisposition(
    disposition,
    summary,
    typeof dispositionRaw === "object" && dispositionRaw
      ? String((dispositionRaw as Record<string, unknown>)["status"] ?? "")
      : "",
    sheetStatusLabel,
  );

  if (callbackHit && call.userId) {
    const scheduledAt = await scheduleSheetCallback({
      callId,
      agentId: call.agentId,
      userId: call.userId,
      phone,
      campaignLeadId: lead?.id ?? null,
      dispositionText: disposition || summary,
      dispositionRaw,
    });
    if (scheduledAt) {
      if (sheetStatusLabel !== "Booked") {
        sheetStatusLabel = "Callback scheduled";
      }
      nextFollowUpValue = formatSheetIst(scheduledAt);
    }
  }

  if ((mode === "same_sheet" || mode === "both") && sheetRowIndex != null) {
    try {
      const headerNames = [
        cols.status, cols.lastCallAt, cols.disposition, cols.summary,
        cols.callId, cols.recording, cols.nextFollowUp,
      ].filter(Boolean) as string[];
      await ensureHeaders(
        call.userId,
        pipeline.connectionId,
        pipeline.spreadsheetId,
        pipeline.sheetName,
        headerNames,
      );

      const updates: Record<string, string> = {};
      if (cols.status) updates[cols.status] = sheetStatusLabel;
      if (cols.lastCallAt) updates[cols.lastCallAt] = formatSheetIst(call.endedAt ?? new Date());
      if (cols.disposition) updates[cols.disposition] = disposition;
      if (cols.summary) updates[cols.summary] = summary;
      if (cols.callId) updates[cols.callId] = String(call.id);
      if (cols.recording) updates[cols.recording] = sheetRecordingUrl(call);
      if (cols.nextFollowUp && nextFollowUpValue) {
        updates[cols.nextFollowUp] = nextFollowUpValue;
      }
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
          startedAt: formatSheetIst(call.createdAt),
          durationSeconds: call.durationSeconds ?? 0,
          direction,
          phone,
          callerName: identity.name || lead?.name || "",
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

  // Safety net: booking created on this call but tool hook may have missed writeback
  try {
    const [booking] = await db
      .select({
        slotStart: bookingsTable.slotStart,
        meetLink: bookingsTable.meetLink,
        status: bookingsTable.status,
      })
      .from(bookingsTable)
      .where(and(
        eq(bookingsTable.callId, callId),
        ne(bookingsTable.status, "cancelled"),
      ))
      .limit(1);
    if (booking?.slotStart) {
      await writeSheetBookingForCall(callId, {
        slotStart: booking.slotStart,
        meetLink: booking.meetLink,
      });
    }
  } catch (err) {
    logger.warn({ err, callId }, "sheet-auto-call: booking safety-net failed");
  }
}

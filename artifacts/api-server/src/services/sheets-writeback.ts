/**
 * Google Sheets post-call writeback + session-start lookup orchestration.
 * Fire-and-forget from endSession / PATCH /calls/:id/end — never blocks hangup.
 */

import { and, eq } from "drizzle-orm";
import { db, callsTable, agentsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import {
  listEnabledBindings,
  appendCallLogRow,
  updateOutcomeRow,
  runLookupBindings,
} from "./google-sheets.js";

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
  const fields: Record<string, string | number | null | undefined> = {
    callId: call.id,
    startedAt: formatIst(call.createdAt),
    durationSeconds: call.durationSeconds ?? 0,
    direction,
    phone,
    callerName: "",
    disposition: formatDisposition(opts?.dispositionResult ?? call.dispositionResult),
    summary: opts?.callSummary ?? call.callSummary ?? "",
    recordingUrl: call.recordingUrl ?? "",
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
  const disposition = formatDisposition(opts?.dispositionResult ?? call.dispositionResult);
  const status = disposition || call.status || "completed";

  const fields: Record<string, string | number | null | undefined> = {
    phone,
    name: "",
    email: "",
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

import { db, executionLogsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

/**
 * Shared execution-logging helper.
 *
 * Both the telephony pipeline (`orchestration/pipeline.ts` + `session.ts`) and
 * the web-call path (`orchestration/telephony/webcall.ts`) write per-component
 * execution rows to `execution_logs` so the dashboard Call Log "Logs" tab shows
 * an identical, chronological step-by-step timeline for every call type.
 *
 * Writes are fire-and-forget: a failed insert is swallowed and logged via
 * `logger.warn` — logging must NEVER break or stall a live call.
 */

export type ExecDirection = "request" | "response" | "system";
export type ExecStatus = "success" | "error" | "info";

export interface ExecLogOpts {
  provider?: string;
  status?: ExecStatus;
  latencyMs?: number;
  requestPayload?: Record<string, unknown>;
  responsePayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Write a single execution-log row. Fire-and-forget — never throws, never
 * blocks the caller, and warns (not console.log) on failure.
 */
export function writeExecutionLog(
  callId: number,
  agentId: number | null,
  component: string,
  direction: ExecDirection,
  opts: ExecLogOpts = {},
): void {
  void db
    .insert(executionLogsTable)
    .values({
      callId,
      agentId,
      component,
      direction,
      provider: opts.provider ?? null,
      status: opts.status ?? "info",
      latencyMs: opts.latencyMs ?? null,
      requestPayload: opts.requestPayload ?? null,
      responsePayload: opts.responsePayload ?? null,
      metadata: opts.metadata ?? null,
    })
    .catch((err: unknown) => {
      logger.warn({ callId, component, direction, err }, "writeExecutionLog: failed to write execution log row");
    });
}

/**
 * Bind a logger to a single call so callers can write rows with just the
 * component/direction/opts (the same ergonomic shape both paths already use).
 */
export function createExecutionLogger(callId: number, agentId: number | null) {
  return (component: string, direction: ExecDirection, opts: ExecLogOpts = {}): void =>
    writeExecutionLog(callId, agentId, component, direction, opts);
}

/**
 * Format an unknown thrown value into a human-readable failure reason for the
 * execution log's payload, so the Logs tab shows the real cause instead of a
 * bare `ERR`. Mirrors `toReadableError` but without a category prefix; pass a
 * `prefix` when the component context isn't already obvious from the row.
 */
export function formatExecError(err: unknown, prefix?: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const clean = raw.replace(/^Error:\s*/i, "").trim() || "unknown error";
  return prefix ? `${prefix}: ${clean}` : clean;
}

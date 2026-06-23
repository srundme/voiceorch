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

/**
 * Canonical component names used across both pipeline paths so the Logs tab
 * timeline reads consistently. `component` is a free-text column in the DB —
 * this is the shared vocabulary, not an enum constraint.
 */
export const EXEC_COMPONENTS = {
  Agent: "Agent",
  Telephony: "Telephony",
  STT: "STT",
  LLM: "LLM",
  TTS: "TTS",
  Tool: "Tool",
  Memory: "Memory",
  Knowledge: "Knowledge",
  VariableResolver: "VariableResolver",
  Webhook: "Webhook",
  Recording: "Recording",
  Diagnostics: "Diagnostics",
  Compliance: "Compliance",
  Billing: "Billing",
} as const;
export type ExecComponent = (typeof EXEC_COMPONENTS)[keyof typeof EXEC_COMPONENTS];

export interface ExecLogOpts {
  provider?: string;
  status?: ExecStatus;
  latencyMs?: number;
  requestPayload?: Record<string, unknown>;
  responsePayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  // ── Per-entry enrichment ──────────────────────────────────────────────────
  // Folded into `metadata` so the Logs tab can render extra columns/badges
  // without a risky schema migration (see the drizzle-push gotcha). All
  // optional — only present keys are written.
  turnNumber?: number;
  relatedTurnId?: number | string;
  durationMs?: number;
  retryCount?: number;
  warningFlags?: string[];
  errorMessage?: string;
  errorCode?: string | number;
}

/**
 * Merge the enrichment fields into the metadata object so the row carries them
 * for the frontend. Returns null when nothing would be written (keeps the
 * column NULL instead of an empty object).
 */
function buildMetadata(opts: ExecLogOpts): Record<string, unknown> | null {
  const md: Record<string, unknown> = { ...(opts.metadata ?? {}) };
  if (opts.turnNumber !== undefined) md["turnNumber"] = opts.turnNumber;
  if (opts.relatedTurnId !== undefined) md["relatedTurnId"] = opts.relatedTurnId;
  if (opts.durationMs !== undefined) md["durationMs"] = opts.durationMs;
  if (opts.retryCount !== undefined) md["retryCount"] = opts.retryCount;
  if (opts.warningFlags !== undefined && opts.warningFlags.length > 0) md["warningFlags"] = opts.warningFlags;
  if (opts.errorMessage !== undefined) md["errorMessage"] = opts.errorMessage;
  if (opts.errorCode !== undefined) md["errorCode"] = opts.errorCode;
  return Object.keys(md).length > 0 ? md : null;
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
      metadata: buildMetadata(opts),
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

// ── Structured "Call Ended" final entry ─────────────────────────────────────
//
// The last row of every call must explain WHY the call ended. Both pipeline
// paths feed their own raw reason string (e.g. "normal", "disconnected",
// "timeout", "silence_timeout", "error") into `buildCallEndedSummary`, which
// normalises it into the canonical disconnect taxonomy and a human-readable,
// structured payload the frontend renders as a summary card.

export type DisconnectReason =
  | "completed"
  | "user_hangup"
  | "silence_timeout"
  | "max_duration_reached"
  | "provider_error"
  | "insufficient_balance"
  | "transfer_completed"
  | "failed";

export type CallOutcome = "Completed" | "Timeout" | "Error" | "Call Terminated" | "Transferred";

export interface CallEndedInput {
  /** Path-specific raw reason string (normal/disconnected/timeout/silence_timeout/error/…). */
  rawReason: string;
  durationSeconds: number;
  turns: number;
  /** Provider involved in the disconnect, if any. */
  provider?: string | null;
  /** Override the inferred triggering component (Telephony/STT/LLM/TTS/Tool/Agent/Billing). */
  component?: string | null;
  errorMessage?: string | null;
  errorCode?: string | number | null;
  retryAttempted?: boolean;
  fallbackAttempted?: boolean;
  recoverySucceeded?: boolean | null;
}

export interface CallEndedSummary {
  reason: DisconnectReason;
  reasonLabel: string;
  component: string;
  provider: string | null;
  errorCode: string | number | null;
  errorMessage: string | null;
  expected: boolean;
  retryAttempted: boolean;
  fallbackAttempted: boolean;
  recoverySucceeded: boolean | null;
  outcome: CallOutcome;
  durationSeconds: number;
  turns: number;
}

interface ReasonMapping {
  reason: DisconnectReason;
  label: string;
  outcome: CallOutcome;
  expected: boolean;
  component: string;
}

/** Normalise a path-specific raw reason string into the canonical taxonomy. */
function normalizeDisconnectReason(raw: string): ReasonMapping {
  const r = (raw || "").toLowerCase().trim();
  switch (r) {
    case "normal":
    case "completed":
    case "complete":
    case "end_call":
      return { reason: "completed", label: "Conversation completed", outcome: "Completed", expected: true, component: "Agent" };
    case "user_hangup":
    case "disconnected":
    case "hangup":
    case "caller_hangup":
      return { reason: "user_hangup", label: "Caller hung up", outcome: "Call Terminated", expected: true, component: "Telephony" };
    case "silence_timeout":
    case "silence":
    case "inactivity":
      return { reason: "silence_timeout", label: "Silence timeout — no caller speech detected", outcome: "Timeout", expected: true, component: "STT" };
    case "timeout":
    case "max_duration":
    case "max_duration_reached":
      return { reason: "max_duration_reached", label: "Maximum call duration reached", outcome: "Timeout", expected: true, component: "Agent" };
    case "insufficient_balance":
    case "no_balance":
    case "out_of_balance":
      return { reason: "insufficient_balance", label: "Insufficient wallet balance", outcome: "Call Terminated", expected: true, component: "Billing" };
    case "transfer_completed":
    case "transferred":
    case "transfer":
      return { reason: "transfer_completed", label: "Call transferred to a human agent", outcome: "Transferred", expected: true, component: "Telephony" };
    case "provider_error":
      return { reason: "provider_error", label: "Provider error", outcome: "Error", expected: false, component: "Agent" };
    case "error":
    case "failed":
    case "fatal":
      return { reason: "failed", label: "Call failed due to an error", outcome: "Error", expected: false, component: "Agent" };
    default:
      return { reason: "failed", label: `Call ended (${raw})`, outcome: "Error", expected: false, component: "Agent" };
  }
}

/** Build the structured Call-Ended summary payload from a raw reason + context. */
export function buildCallEndedSummary(input: CallEndedInput): CallEndedSummary {
  const m = normalizeDisconnectReason(input.rawReason);
  return {
    reason: m.reason,
    reasonLabel: m.label,
    component: input.component ?? m.component,
    provider: input.provider ?? null,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
    expected: m.expected,
    retryAttempted: input.retryAttempted ?? false,
    fallbackAttempted: input.fallbackAttempted ?? false,
    recoverySucceeded: input.recoverySucceeded ?? null,
    outcome: m.outcome,
    durationSeconds: input.durationSeconds,
    turns: input.turns,
  };
}

/**
 * Emit the final, structured "Call Ended" row. Always an `Agent`/`system` row;
 * status is `error` for unexpected disconnects and `success` otherwise. The
 * structured summary is carried under `metadata.callEnded` so the frontend can
 * render it as a prominent summary card. Fire-and-forget.
 */
export function writeCallEndedLog(
  callId: number,
  agentId: number | null,
  input: CallEndedInput,
  extraMetadata: Record<string, unknown> = {},
): void {
  const summary = buildCallEndedSummary(input);
  writeExecutionLog(callId, agentId, EXEC_COMPONENTS.Agent, "system", {
    status: summary.expected ? "success" : "error",
    provider: summary.provider ?? undefined,
    errorMessage: summary.errorMessage ?? undefined,
    errorCode: summary.errorCode ?? undefined,
    metadata: {
      callEnded: summary,
      durationSeconds: summary.durationSeconds,
      turns: summary.turns,
      ...extraMetadata,
    },
  });
}

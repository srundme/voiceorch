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
  RecruiterBrain: "RecruiterBrain",
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

// ── Per-call lifecycle stat accumulator ─────────────────────────────────────
//
// Counts of warnings / errors / retries / fallbacks (and the last component to
// execute) are folded into the final "Call Ended" summary. They are tracked
// *synchronously* at row-write time — keyed by callId in a module-level Map —
// so BOTH pipeline paths and EVERY emit site contribute with zero plumbing.
// `writeCallEndedLog` reads-then-clears the entry for the call. The Call-Ended
// row itself is excluded from tracking (it carries `metadata.callEnded`).

interface CallStats {
  warnings: number;
  errors: number;
  retries: number;
  fallbacks: number;
  lastComponent: string | null;
}

const callStats = new Map<number, CallStats>();

function blankStats(): CallStats {
  return { warnings: 0, errors: 0, retries: 0, fallbacks: 0, lastComponent: null };
}

function trackStats(callId: number, component: string, opts: ExecLogOpts): void {
  const s = callStats.get(callId) ?? blankStats();
  s.lastComponent = component;
  const flags = opts.warningFlags;
  if (flags && flags.length > 0) {
    s.warnings += 1;
    if (flags.includes("provider_fallback")) s.fallbacks += 1;
  }
  if (opts.status === "error") s.errors += 1;
  if (typeof opts.retryCount === "number" && opts.retryCount > 0) s.retries += opts.retryCount;
  callStats.set(callId, s);
}

/** Read-and-clear the accumulated stats for a call (called once at call end). */
function consumeCallStats(callId: number): CallStats {
  const s = callStats.get(callId) ?? blankStats();
  callStats.delete(callId);
  return s;
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
  // Accumulate lifecycle stats synchronously (the Call-Ended summary row is
  // excluded — it reports the totals, it doesn't contribute to them).
  if (!(opts.metadata && (opts.metadata as Record<string, unknown>)["callEnded"])) {
    trackStats(callId, component, opts);
  }
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
 * The minimal logging-function shape shared by both pipeline paths:
 * the telephony pipeline's `this.logExec` and the web-call path's
 * `logExecution` (from `createExecutionLogger`) both match this signature.
 * Lifecycle helpers below accept it so a single implementation drives both
 * paths identically (webcall ≡ telephony parity).
 */
export type ExecLogFn = (component: string, direction: ExecDirection, opts?: ExecLogOpts) => void;

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
  | "media_disconnect"
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
  // ── Lifecycle-trace enrichment (folded into the summary card) ───────────────
  /** Last pipeline component to execute before teardown. */
  lastComponent?: string | null;
  /** Last thing the caller said (final user turn). */
  lastUserTranscript?: string | null;
  /** Last thing the agent said (final assistant turn). */
  lastAgentResponse?: string | null;
  /** Human-readable recording outcome (e.g. "Saved", "Failed: …", "Disabled"). */
  recordingStatus?: string | null;
  /** Counts during the call — default to the per-call stat accumulator. */
  warningCount?: number;
  errorCount?: number;
  retryCount?: number;
  fallbackCount?: number;
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
  // ── Lifecycle-trace enrichment ──────────────────────────────────────────────
  lastComponent: string | null;
  lastUserTranscript: string | null;
  lastAgentResponse: string | null;
  recordingStatus: string | null;
  warningCount: number;
  errorCount: number;
  retryCount: number;
  fallbackCount: number;
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
    case "tool ended call":
    case "tool_ended_call":
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
    case "media_disconnect":
    case "carrier_disconnect":
    case "early_media_drop":
      // VoBiz often closes the media WS (4010 End Of XML / bridge idle) while the
      // callee still has the phone up. Do NOT call this "Caller hung up".
      return {
        reason: "media_disconnect",
        label: "Media stream closed by carrier (caller may still be on the line)",
        outcome: "Call Terminated",
        expected: false,
        component: "Telephony",
      };
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
  const retryCount = input.retryCount ?? 0;
  const fallbackCount = input.fallbackCount ?? 0;
  return {
    reason: m.reason,
    reasonLabel: m.label,
    component: input.component ?? input.lastComponent ?? m.component,
    provider: input.provider ?? null,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
    expected: m.expected,
    retryAttempted: (input.retryAttempted ?? false) || retryCount > 0,
    fallbackAttempted: (input.fallbackAttempted ?? false) || fallbackCount > 0,
    recoverySucceeded: input.recoverySucceeded ?? null,
    outcome: m.outcome,
    durationSeconds: input.durationSeconds,
    turns: input.turns,
    lastComponent: input.lastComponent ?? null,
    lastUserTranscript: input.lastUserTranscript ?? null,
    lastAgentResponse: input.lastAgentResponse ?? null,
    recordingStatus: input.recordingStatus ?? null,
    warningCount: input.warningCount ?? 0,
    errorCount: input.errorCount ?? 0,
    retryCount,
    fallbackCount,
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
  // Read-and-clear the per-call lifecycle counters; explicit input fields win
  // over the accumulator when a caller passes them.
  const stats = consumeCallStats(callId);
  const merged: CallEndedInput = {
    ...input,
    lastComponent: input.lastComponent ?? stats.lastComponent ?? null,
    warningCount: input.warningCount ?? stats.warnings,
    errorCount: input.errorCount ?? stats.errors,
    retryCount: input.retryCount ?? stats.retries,
    fallbackCount: input.fallbackCount ?? stats.fallbacks,
  };
  const summary = buildCallEndedSummary(merged);
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

// ── Lifecycle-event helpers (shared, drive BOTH pipeline paths identically) ──
//
// Each helper writes a recognisable, labelled `metadata.event` row so the Logs
// tab renders it via its existing generic event branch (no frontend change
// needed). They accept an `ExecLogFn` so the telephony pipeline (`this.logExec`)
// and the web-call path (`logExecution`) emit identical rows.

/** Connection/handshake info for the opening "Call Started" row. */
export interface CallStartedInfo {
  sessionId?: string | null;
  /** "Webcall" (browser WebRTC) or "Live Call" (telephony). */
  callType: "Webcall" | "Live Call";
  direction?: "Inbound" | "Outbound" | null;
  recordingEnabled?: boolean;
  webrtcConnected?: boolean | null;
  mediaStreamStarted?: boolean | null;
  agentName?: string | null;
  asrProvider?: string | null;
  llmProvider?: string | null;
  ttsProvider?: string | null;
  ttsVoice?: string | null;
  /** Optional extra metadata (e.g. telephonyProvider). */
  extra?: Record<string, unknown>;
}

/**
 * Opening lifecycle row: the call session/connection is established. Replaces
 * each path's bare "seed" Agent row so the timeline starts with a labelled
 * "Call Started" event carrying connection + pipeline-config context.
 */
export function writeCallStartedLog(callId: number, agentId: number | null, info: CallStartedInfo): void {
  writeExecutionLog(callId, agentId, EXEC_COMPONENTS.Agent, "system", {
    status: "info",
    requestPayload: {
      agentId,
      agentName: info.agentName ?? null,
      asrProvider: info.asrProvider ?? null,
      llmProvider: info.llmProvider ?? null,
      ttsProvider: info.ttsProvider ?? null,
      ttsVoice: info.ttsVoice ?? null,
    },
    metadata: {
      event: "Call Started",
      callId,
      sessionId: info.sessionId ?? null,
      callType: info.callType,
      direction: info.direction ?? null,
      recordingEnabled: info.recordingEnabled ?? false,
      webrtcConnected: info.webrtcConnected ?? null,
      mediaStreamStarted: info.mediaStreamStarted ?? null,
      connectionEstablishedAt: new Date().toISOString(),
      ...(info.extra ?? {}),
    },
  });
}

export type PlaybackEvent =
  | "Playback Started"
  | "Playback Completed"
  | "Playback Interrupted"
  | "Playback Cancelled";

export interface PlaybackInfo {
  provider?: string;
  turnNumber?: number;
  playbackDurationMs?: number;
  audioDurationMs?: number;
  /** Why playback stopped — surfaced in the row preview via the `reason` key. */
  stopReason?: string;
  sentenceIndex?: number;
}

/** TTS playback lifecycle row. "Playback Interrupted" is flagged as a warning. */
export function logPlaybackEvent(log: ExecLogFn, event: PlaybackEvent, info: PlaybackInfo = {}): void {
  const interrupted = event === "Playback Interrupted";
  log(EXEC_COMPONENTS.TTS, "system", {
    status: "info",
    provider: info.provider,
    turnNumber: info.turnNumber,
    durationMs: info.playbackDurationMs,
    warningFlags: interrupted ? ["playback_interrupted"] : undefined,
    metadata: {
      event,
      ...(info.stopReason ? { reason: info.stopReason } : {}),
      ...(info.audioDurationMs != null ? { audioDurationMs: info.audioDurationMs } : {}),
      ...(info.sentenceIndex != null ? { sentenceIndex: info.sentenceIndex } : {}),
    },
  });
}

export type RecordingEvent = "Recording Started" | "Recording Saved" | "Recording Uploaded" | "Recording Failed";

export interface RecordingInfo {
  durationMs?: number;
  byteSize?: number;
  url?: string | null;
  error?: string | null;
  sampleRate?: number;
}

/** Call-recording buffer/upload lifecycle row. "Recording Failed" is an error. */
export function logRecordingEvent(log: ExecLogFn, event: RecordingEvent, info: RecordingInfo = {}): void {
  const failed = event === "Recording Failed";
  log(EXEC_COMPONENTS.Recording, "system", {
    status: failed ? "error" : "info",
    durationMs: info.durationMs,
    errorMessage: failed ? info.error ?? undefined : undefined,
    warningFlags: failed ? ["recording_failed"] : undefined,
    metadata: {
      event,
      ...(info.url ? { url: info.url } : {}),
      ...(info.byteSize != null ? { byteSize: info.byteSize } : {}),
      ...(info.sampleRate != null ? { sampleRate: info.sampleRate } : {}),
      ...(failed && info.error ? { error: info.error } : {}),
    },
  });
}

/**
 * Middle tool-lifecycle row, emitted between the existing Tool request
 * ("Requested") and Tool response ("Completed") rows so the Logs tab shows the
 * full Requested → Started → Completed sequence. The request/response rows are
 * deliberately left unlabelled so their rich arg/result previews still render.
 */
export function logToolExecutionStarted(log: ExecLogFn, info: { tool: string; turnNumber?: number }): void {
  log(EXEC_COMPONENTS.Tool, "system", {
    status: "info",
    turnNumber: info.turnNumber,
    metadata: { event: "Execution Started", tool: info.tool },
  });
}

export interface WarningInfo {
  turnNumber?: number;
  provider?: string;
  retryCount?: number;
  errorMessage?: string;
  /** Extra detail merged into metadata (use `reason` to surface in the preview). */
  detail?: Record<string, unknown>;
}

/**
 * Generic warning/error lifecycle row (STT Timeout, Provider Reconnected,
 * Silence Reprompt, …). `flags` populate `warningFlags` so the row is counted
 * by the per-call accumulator and badged in the UI.
 */
export function logWarningEvent(
  log: ExecLogFn,
  component: string,
  event: string,
  flags: string[],
  info: WarningInfo = {},
): void {
  log(component, "system", {
    status: "info",
    provider: info.provider,
    turnNumber: info.turnNumber,
    retryCount: info.retryCount,
    errorMessage: info.errorMessage,
    warningFlags: flags,
    metadata: { event, ...(info.detail ?? {}) },
  });
}

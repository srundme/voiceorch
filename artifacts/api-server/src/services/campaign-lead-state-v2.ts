/**
 * Campaign lead state V2.
 *
 * Modes (`CAMPAIGN_LEAD_STATE_V2`):
 *   off     — legacy hangup/retry only
 *   shadow  — legacy behavior + comparison telemetry
 *   canary  — V2 writer only for CAMPAIGN_LEAD_STATE_V2_CANARY_CAMPAIGN_IDS
 *   on      — V2 writer globally (do not set in production from this phase)
 */

import { canonicalDispositionFromLabel } from "../lib/disposition/canonical.js";

export const CAMPAIGN_LEAD_STATE_V2_ENV = "CAMPAIGN_LEAD_STATE_V2";
export const CAMPAIGN_LEAD_STATE_V2_CANARY_ENV = "CAMPAIGN_LEAD_STATE_V2_CANARY_CAMPAIGN_IDS";
export const CAMPAIGN_LEAD_STATE_V2_EVENT = "Campaign Lead State V2";

/** Concurrency slots stay exactly these two values. Do not expand. */
export const CAMPAIGN_CONCURRENCY_SLOT_STATUSES = ["calling", "connected"] as const;
export type CampaignConcurrencySlotStatus =
  (typeof CAMPAIGN_CONCURRENCY_SLOT_STATUSES)[number];

export type CampaignLeadStateV2Mode = "off" | "shadow" | "canary" | "on";

export type CampaignAttemptStatus =
  | "answered"
  | "caller_hangup"
  | "agent_end"
  | "completed"
  | "dropped"
  | "busy"
  | "no_pickup"
  | "failed"
  | "voicemail"
  | "dial_error"
  | "transferred"
  | "stuck_calling";

export type CampaignCallEndClass = "A" | "B" | "C" | "D";

export type ClassifyCampaignCallEndClass = CampaignCallEndClass | "voicemail" | "transferred";

export type ClassifyCampaignCallEndInput = {
  naturalEndTriggered: boolean;
  wasTransferred: boolean;
  conversationCompleted: boolean;
  transcriptHasFarewellEnding: boolean;
  endReasonHint: string | null;
  callEndedReason: string | null;
  expectedDisconnect: boolean | null;
  turnCount: number;
  durationSeconds: number;
  isVoicemail: boolean;
  waitingForReply?: boolean;
  disposition?: string | null;
  lastUserTranscript?: string | null;
};

export type ClassifyCampaignCallEndResult = {
  class: ClassifyCampaignCallEndClass;
  lastAttemptStatus: CampaignAttemptStatus;
  retryEligible: boolean;
  proposedRetryReason: string | null;
  proposedLeadStatus: string;
};

/** Strong media/network evidence. `carrier_disconnect` is NOT in this set. */
const STRONG_DROP_REASONS = new Set([
  "media_disconnect",
  "early_media_drop",
]);

const USER_HANGUP_REASONS = new Set([
  "user_hangup",
  "hangup",
  "disconnected",
  "caller_hangup",
]);

const AGENT_END_REASONS = new Set([
  "end_call",
  "completed",
  "complete",
  "normal",
  "tool ended call",
  "tool_ended_call",
]);

const BUSINESS_BUCKETS = new Set([
  "interested",
  "callback requested",
  "not interested",
]);

const PROTECTED_BUSINESS_BUCKETS = new Set([
  "interested",
  "callback requested",
  "not interested",
  "booked",
  "booking created",
  "transferred",
  "transfer completed",
]);

const TECHNICAL_DISPOSITION_BUCKETS = new Set([
  "no pickup",
  "busy",
  "voicemail",
  "failed",
]);

const CALLBACK_UTTERANCE =
  /\b(call me|call back|callback|call later|not now|call monday|call tomorrow)\b/i;

export function resolveCampaignLeadStateV2Mode(
  env: NodeJS.ProcessEnv = process.env,
): CampaignLeadStateV2Mode {
  const raw = (env[CAMPAIGN_LEAD_STATE_V2_ENV] ?? "off").trim().toLowerCase();
  if (raw === "shadow") return "shadow";
  if (raw === "canary") return "canary";
  if (raw === "on" || raw === "true" || raw === "1") return "on";
  return "off";
}

export function parseCampaignLeadStateV2CanaryIds(
  env: NodeJS.ProcessEnv = process.env,
): Set<number> {
  const raw = (env[CAMPAIGN_LEAD_STATE_V2_CANARY_ENV] ?? "").trim();
  if (!raw) return new Set();
  const ids = new Set<number>();
  for (const part of raw.split(/[,\s]+/)) {
    if (!part) continue;
    const n = Number(part);
    if (Number.isInteger(n) && n > 0) ids.add(n);
  }
  return ids;
}

/** Global writer (`on`). Prefer `isCampaignLeadStateV2Writer` for canary. */
export function isCampaignLeadStateV2(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveCampaignLeadStateV2Mode(env) === "on";
}

export function isCampaignLeadStateV2Writer(
  campaignId: number | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const mode = resolveCampaignLeadStateV2Mode(env);
  if (mode === "on") return true;
  if (mode !== "canary") return false;
  if (campaignId == null || !Number.isInteger(campaignId) || campaignId <= 0) return false;
  return parseCampaignLeadStateV2CanaryIds(env).has(campaignId);
}

export function shouldLogCampaignLeadStateV2Shadow(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveCampaignLeadStateV2Mode(env) === "shadow";
}

export function shouldLogCampaignLeadStateV2Canary(
  campaignId: number | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isCampaignLeadStateV2Writer(campaignId, env);
}

/**
 * Mirror of execution-log expected/unexpected mapping. Pure so the classifier
 * does not depend on logging I/O.
 */
export function inferExpectedDisconnect(reason: string | null | undefined): boolean | null {
  if (!reason) return null;
  const r = reason.toLowerCase().trim();
  if (
    r === "user_hangup" ||
    r === "hangup" ||
    r === "disconnected" ||
    r === "caller_hangup" ||
    r === "completed" ||
    r === "complete" ||
    r === "normal" ||
    r === "end_call" ||
    r === "silence_timeout" ||
    r === "silence" ||
    r === "inactivity" ||
    r === "max_duration" ||
    r === "max_duration_reached" ||
    r === "transfer_completed" ||
    r === "transferred" ||
    r === "transfer"
  ) {
    return true;
  }
  if (
    r === "media_disconnect" ||
    r === "carrier_disconnect" ||
    r === "early_media_drop" ||
    r === "provider_error" ||
    r === "failed" ||
    r === "error" ||
    r === "fatal"
  ) {
    return false;
  }
  return null;
}

/** Same derivation endSession uses for writeCallEndedLog, extracted for reuse. */
export function resolveCallEndedReason(opts: {
  reason?: string | null;
  wasTransferred: boolean;
  endReasonHint: string | null;
  naturalEndTriggered: boolean;
  turnCount: number;
  durationSeconds: number;
  direction?: string | null;
}): string {
  const raw =
    opts.reason ??
    (opts.wasTransferred
      ? "transfer_completed"
      : opts.endReasonHint
        ? opts.endReasonHint
        : opts.naturalEndTriggered
          ? "completed"
          : "user_hangup");
  if (
    raw === "user_hangup" &&
    opts.turnCount === 0 &&
    opts.durationSeconds > 0 &&
    opts.durationSeconds < 45 &&
    opts.direction === "outbound"
  ) {
    return "early_media_drop";
  }
  return raw;
}

function normReason(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().trim();
}

function isMeaningfulConversation(input: ClassifyCampaignCallEndInput): boolean {
  return input.turnCount >= 1 || input.durationSeconds > 15;
}

function isUserHangup(input: ClassifyCampaignCallEndInput): boolean {
  return USER_HANGUP_REASONS.has(normReason(input.callEndedReason));
}

/** Normal caller hangup after talk — never a retryable drop, even if carrier later says disconnect. */
function isExpectedCallerHangup(input: ClassifyCampaignCallEndInput): boolean {
  return isUserHangup(input) && input.expectedDisconnect !== false && isMeaningfulConversation(input);
}

function hasStrongMediaDrop(input: ClassifyCampaignCallEndInput): boolean {
  const hint = normReason(input.endReasonHint);
  const ended = normReason(input.callEndedReason);
  return STRONG_DROP_REASONS.has(hint) || STRONG_DROP_REASONS.has(ended);
}

function isCarrierDisconnect(input: ClassifyCampaignCallEndInput): boolean {
  return (
    normReason(input.endReasonHint) === "carrier_disconnect" ||
    normReason(input.callEndedReason) === "carrier_disconnect"
  );
}

/**
 * Retryable genuine drop requires strong evidence.
 * `carrier_disconnect` alone is not enough.
 */
function isGenuineDrop(input: ClassifyCampaignCallEndInput): boolean {
  if (isExpectedCallerHangup(input)) return false;
  if (hasStrongMediaDrop(input)) return true;
  if (input.waitingForReply === true && input.expectedDisconnect === false) return true;
  if (
    isCarrierDisconnect(input) &&
    input.expectedDisconnect === false &&
    input.waitingForReply === true
  ) {
    return true;
  }
  return false;
}

function isSuccessWithoutEndCall(input: ClassifyCampaignCallEndInput): boolean {
  const ended = normReason(input.callEndedReason);
  return (
    input.naturalEndTriggered ||
    input.conversationCompleted ||
    input.transcriptHasFarewellEnding ||
    AGENT_END_REASONS.has(ended)
  );
}

export function isBusinessEndingDisposition(disposition: string | null | undefined): boolean {
  const bucket = canonicalDispositionFromLabel(disposition);
  if (!bucket) return false;
  if (BUSINESS_BUCKETS.has(bucket)) return true;
  if (bucket.includes("interested")) return true;
  if (bucket.includes("callback") || bucket.includes("call back")) return true;
  return false;
}

export function isCallbackUtterance(text: string | null | undefined): boolean {
  if (!text) return false;
  return CALLBACK_UTTERANCE.test(text);
}

function isBusinessEnding(input: ClassifyCampaignCallEndInput): boolean {
  return isBusinessEndingDisposition(input.disposition) || isCallbackUtterance(input.lastUserTranscript);
}

/**
 * Pure hangup classifier. Must NOT use `duration > 15 && !naturalEndTriggered`
 * as sufficient evidence of a network drop. Must NOT treat `carrier_disconnect`
 * alone as class A.
 */
export function classifyCampaignCallEnd(
  input: ClassifyCampaignCallEndInput,
): ClassifyCampaignCallEndResult {
  if (input.wasTransferred) {
    return {
      class: "transferred",
      lastAttemptStatus: "transferred",
      retryEligible: false,
      proposedRetryReason: null,
      proposedLeadStatus: "transferred",
    };
  }

  if (input.isVoicemail) {
    return {
      class: "voicemail",
      lastAttemptStatus: "voicemail",
      retryEligible: true,
      proposedRetryReason: "voicemail",
      proposedLeadStatus: "voicemail",
    };
  }

  if (isGenuineDrop(input)) {
    return {
      class: "A",
      lastAttemptStatus: "dropped",
      retryEligible: true,
      proposedRetryReason: "dropped",
      proposedLeadStatus: "pending",
    };
  }

  const success = isSuccessWithoutEndCall(input);
  const hangupAfterTalk = isUserHangup(input) && isMeaningfulConversation(input);
  const business = isBusinessEnding(input) && (hangupAfterTalk || success || isMeaningfulConversation(input));

  if (business) {
    return {
      class: "D",
      lastAttemptStatus: success && !hangupAfterTalk ? "completed" : "caller_hangup",
      retryEligible: false,
      proposedRetryReason: null,
      proposedLeadStatus: "completed",
    };
  }

  if (success) {
    return {
      class: "C",
      lastAttemptStatus: input.naturalEndTriggered ? "agent_end" : "completed",
      retryEligible: false,
      proposedRetryReason: null,
      proposedLeadStatus: "completed",
    };
  }

  if (hangupAfterTalk || isUserHangup(input)) {
    return {
      class: "B",
      lastAttemptStatus: "caller_hangup",
      retryEligible: false,
      proposedRetryReason: null,
      proposedLeadStatus: "completed",
    };
  }

  return {
    class: "C",
    lastAttemptStatus: "completed",
    retryEligible: false,
    proposedRetryReason: null,
    proposedLeadStatus: "completed",
  };
}

/** Exact replica of today's campaign endSession midConvDrop decision. */
export function classifyCampaignHangupLegacy(input: {
  isVoicemail: boolean;
  naturalEndTriggered: boolean;
  wasTransferred: boolean;
  durationSeconds: number;
}): {
  oldClassification: string;
  oldLeadStatus: string;
  oldRetryReason: string | null;
} {
  const midConvDrop =
    !input.isVoicemail &&
    !input.naturalEndTriggered &&
    !input.wasTransferred &&
    input.durationSeconds > 15;

  if (input.isVoicemail) {
    return { oldClassification: "voicemail", oldLeadStatus: "voicemail", oldRetryReason: "voicemail" };
  }
  if (input.wasTransferred) {
    return { oldClassification: "transferred", oldLeadStatus: "transferred", oldRetryReason: null };
  }
  if (midConvDrop) {
    return { oldClassification: "network_drop", oldLeadStatus: "failed", oldRetryReason: "network_drop" };
  }
  return { oldClassification: "completed", oldLeadStatus: "completed", oldRetryReason: null };
}

export type V2HangupPlan = {
  wantsRetry: boolean;
  retryReason: string | null;
  lastAttemptStatus: CampaignAttemptStatus;
  desiredStatusIfRetryOk: string;
  fallbackStatusIfRetryFails: string;
};

/**
 * Desired V2 park *assuming* retry insert succeeded when wanted.
 * `failed` is never a legal answered park.
 */
export function planV2AnsweredHangup(opts: {
  answeredEver: boolean;
  classification: ClassifyCampaignCallEndResult;
}): V2HangupPlan {
  const { classification } = opts;
  if (classification.lastAttemptStatus === "transferred") {
    return {
      wantsRetry: false,
      retryReason: null,
      lastAttemptStatus: "transferred",
      desiredStatusIfRetryOk: "transferred",
      fallbackStatusIfRetryFails: "transferred",
    };
  }
  if (classification.lastAttemptStatus === "voicemail") {
    return {
      wantsRetry: classification.retryEligible,
      retryReason: "voicemail",
      lastAttemptStatus: "voicemail",
      desiredStatusIfRetryOk: "pending",
      fallbackStatusIfRetryFails: "voicemail",
    };
  }
  if (classification.retryEligible) {
    return {
      wantsRetry: true,
      retryReason: classification.proposedRetryReason ?? "dropped",
      lastAttemptStatus: classification.lastAttemptStatus,
      desiredStatusIfRetryOk: "pending",
      // Safe fallback: never pending without a future retry row (refill would
      // claim immediately). Never failed (answered+failed is forbidden).
      fallbackStatusIfRetryFails: "completed",
    };
  }
  return {
    wantsRetry: false,
    retryReason: null,
    lastAttemptStatus: classification.lastAttemptStatus,
    desiredStatusIfRetryOk: "completed",
    fallbackStatusIfRetryFails: "completed",
  };
}

/**
 * Apply retry-insert outcome. Pending is legal only when a retry row exists
 * (inserted now, or already pending).
 */
export function finalizeV2Park(opts: {
  plan: V2HangupPlan;
  retryOk: boolean;
}): { callStatus: string; lastAttemptStatus: CampaignAttemptStatus; retryScheduled: boolean } {
  if (opts.plan.wantsRetry && opts.retryOk) {
    return {
      callStatus: opts.plan.desiredStatusIfRetryOk,
      lastAttemptStatus: opts.plan.lastAttemptStatus,
      retryScheduled: true,
    };
  }
  return {
    callStatus: opts.plan.wantsRetry
      ? opts.plan.fallbackStatusIfRetryFails
      : opts.plan.desiredStatusIfRetryOk,
    lastAttemptStatus: opts.plan.lastAttemptStatus,
    retryScheduled: false,
  };
}

export function proposeCampaignLeadPark(opts: {
  answeredEver: boolean;
  classification: ClassifyCampaignCallEndResult;
  retryOk?: boolean;
}): { leadStatus: string; retryReason: string | null } {
  const plan = planV2AnsweredHangup(opts);
  const park = finalizeV2Park({
    plan,
    retryOk: opts.retryOk ?? plan.wantsRetry,
  });
  return { leadStatus: park.callStatus, retryReason: plan.retryReason };
}

export function assertV2AnsweredNotFailed(opts: {
  answeredEver: boolean;
  callStatus: string;
}): void {
  if (opts.answeredEver && opts.callStatus === "failed") {
    throw new Error("V2 forbids answered_ever=true with call_status=failed");
  }
}

export function v2ParkNeverAnsweredFailed(opts: {
  answeredEver: boolean;
  mappedStatus: "no_pickup" | "busy" | "failed" | "voicemail";
  retryOk: boolean;
}): string {
  if (opts.answeredEver && opts.mappedStatus === "failed") {
    return opts.retryOk ? "pending" : "completed";
  }
  return opts.mappedStatus;
}

export function v2ParkStuckAnswered(opts: {
  answeredEver: boolean;
  retryOk: boolean;
}): string {
  if (!opts.answeredEver) return "failed";
  return opts.retryOk ? "pending" : "completed";
}

export function shouldDeferCarrierTerminalOnAnsweredLead(opts: {
  v2: boolean;
  answeredEver: boolean;
  callStatus: string;
}): boolean {
  return opts.v2 && opts.answeredEver && opts.callStatus === "connected";
}

export function isProtectedBusinessDisposition(disposition: string | null | undefined): boolean {
  const bucket = canonicalDispositionFromLabel(disposition);
  if (!bucket) return false;
  if (PROTECTED_BUSINESS_BUCKETS.has(bucket)) return true;
  if (bucket.includes("interested")) return true;
  if (bucket.includes("callback") || bucket.includes("call back")) return true;
  if (bucket.includes("book")) return true;
  if (bucket.includes("transfer")) return true;
  return false;
}

export function isTechnicalDispositionLabel(label: string | null | undefined): boolean {
  if (!label || !String(label).trim()) return true;
  const bucket = canonicalDispositionFromLabel(label);
  if (!bucket) return true;
  if (TECHNICAL_DISPOSITION_BUCKETS.has(bucket)) return true;
  const token = String(label).toLowerCase();
  return token.includes("not_connected") || token.includes("not connected");
}

export function shouldPreserveBusinessDisposition(opts: {
  existing: string | null | undefined;
  incoming: string | null | undefined;
}): boolean {
  if (!isProtectedBusinessDisposition(opts.existing)) return false;
  return isTechnicalDispositionLabel(opts.incoming);
}

export function shouldCancelDroppedRetryAfterDisposition(
  disposition: string | null | undefined,
): boolean {
  return isProtectedBusinessDisposition(disposition);
}

export function isCampaignLeadClaimableByRefill(opts: {
  callStatus: string;
  pendingRetryScheduledAt: Date | null;
  now?: Date;
}): boolean {
  if (opts.callStatus !== "pending" && opts.callStatus !== "queued") return false;
  if (
    opts.pendingRetryScheduledAt &&
    opts.pendingRetryScheduledAt.getTime() > (opts.now ?? new Date()).getTime()
  ) {
    return false;
  }
  return true;
}

export function isConcurrencySlotReleased(callStatus: string): boolean {
  return callStatus !== "calling" && callStatus !== "connected";
}

/**
 * answered_ever is monotonic. Callers must never include `false`.
 * Spreading a patch that sets it false throws instead of writing.
 */
export function campaignLeadWritePatch<T extends { answeredEver?: boolean | null }>(
  patch: T,
): T {
  if (patch.answeredEver === false) {
    throw new Error("answered_ever is monotonic and cannot be set to false");
  }
  return patch;
}

export function applyAnsweredEverTransition<T extends { answeredEver: boolean }>(
  current: T,
  patch: Partial<T> & { answeredEver?: boolean },
): T {
  if (patch.answeredEver === false) {
    throw new Error("answered_ever is monotonic and cannot be set to false");
  }
  const next = { ...current, ...patch };
  if (current.answeredEver) next.answeredEver = true;
  return next;
}

export type CampaignLeadStateV2Shadow = {
  oldClassification: string;
  v2Classification: string;
  answeredEver: boolean;
  oldLeadStatus: string;
  proposedLeadStatus: string;
  oldRetryReason: string | null;
  proposedRetryReason: string | null;
  endReasonHint: string | null;
  callEndedReason: string | null;
  expectedDisconnect: boolean | null;
  duration: number;
  turnCount: number;
  conversationCompleted: boolean;
  naturalEndTriggered: boolean;
};

export function buildCampaignLeadStateV2Shadow(opts: {
  answeredEver: boolean;
  classification: ClassifyCampaignCallEndResult;
  legacy: ReturnType<typeof classifyCampaignHangupLegacy>;
  endReasonHint: string | null;
  callEndedReason: string | null;
  expectedDisconnect: boolean | null;
  durationSeconds: number;
  turnCount: number;
  conversationCompleted: boolean;
  naturalEndTriggered: boolean;
}): CampaignLeadStateV2Shadow {
  const proposed = proposeCampaignLeadPark({
    answeredEver: opts.answeredEver,
    classification: opts.classification,
  });
  return {
    oldClassification: opts.legacy.oldClassification,
    v2Classification: opts.classification.class,
    answeredEver: opts.answeredEver,
    oldLeadStatus: opts.legacy.oldLeadStatus,
    proposedLeadStatus: proposed.leadStatus,
    oldRetryReason: opts.legacy.oldRetryReason,
    proposedRetryReason: proposed.retryReason,
    endReasonHint: opts.endReasonHint,
    callEndedReason: opts.callEndedReason,
    expectedDisconnect: opts.expectedDisconnect,
    duration: opts.durationSeconds,
    turnCount: opts.turnCount,
    conversationCompleted: opts.conversationCompleted,
    naturalEndTriggered: opts.naturalEndTriggered,
  };
}

export type CampaignLeadStateV2CanaryLog = {
  event: "campaign_lead_state_v2";
  campaignId: number | null;
  leadId: number;
  callId: number | null;
  answeredEver: boolean;
  classifierClass: string;
  endReason: string | null;
  expectedDisconnect: boolean | null;
  previousCallStatus: string | null;
  finalCallStatus: string;
  lastAttemptStatus: string;
  retryScheduled: boolean;
  retryReason: string | null;
  retryId: number | null;
  retryCancelledAfterDisposition: boolean;
  disposition: string | null;
  operationalOutcome: string | null;
  attempts: number;
  slotReleased: boolean;
};

export function buildCampaignLeadStateV2CanaryLog(
  opts: Omit<CampaignLeadStateV2CanaryLog, "event" | "slotReleased"> & { slotReleased?: boolean },
): CampaignLeadStateV2CanaryLog {
  return {
    event: "campaign_lead_state_v2",
    ...opts,
    slotReleased: opts.slotReleased ?? isConcurrencySlotReleased(opts.finalCallStatus),
  };
}

export function lastAttemptStatusFromCarrierTerminal(
  leadStatus: "no_pickup" | "busy" | "failed" | "voicemail",
): CampaignAttemptStatus {
  return leadStatus;
}

/**
 * AI Test Calls — pure rules shared by the runner, routes, dial path and
 * endSession. No DB / network here so every rule is unit-testable.
 */

export const MAX_TEST_CASES_PER_GENERATE = 10;
export const MAX_RUNS_PER_REQUEST = 10;
/** Test runs dialing at the same time for ONE target agent (each uses 2 call slots). */
export const MAX_CONCURRENT_RUNS_PER_AGENT = 1;
/** Call slots one test run occupies (caller persona leg + target agent leg). */
export const SLOTS_PER_RUN = 2;
export const DEFAULT_TEST_MAX_DURATION_SECONDS = 300;
export const MIN_TEST_MAX_DURATION_SECONDS = 60;
export const MAX_TEST_MAX_DURATION_SECONDS = 900;
/** Inbound legs older than this after the dial are never auto-linked to a run. */
export const CORRELATION_WINDOW_SECONDS = 180;

export const RUN_STATUSES = [
  "queued", "dialing", "in_call", "evaluating", "passed", "failed", "error", "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const ACTIVE_LINE_STATUSES: RunStatus[] = ["dialing", "in_call"];
export const TERMINAL_RUN_STATUSES: RunStatus[] = ["passed", "failed", "error", "cancelled"];

export function isTerminalRunStatus(status: string): boolean {
  return (TERMINAL_RUN_STATUSES as string[]).includes(status);
}

const LIVE_CALL_STATUSES = new Set(["pending", "queued", "initiated", "ringing", "in_progress"]);

export function isLiveCallStatus(status: string | null | undefined): boolean {
  return LIVE_CALL_STATUSES.has(String(status ?? ""));
}

/**
 * Human reason when the persona leg ended without a conversation, or null
 * when the call row looks like a real conversation happened.
 */
export function callerLegFailureReason(call: {
  status: string;
  durationSeconds: number | null;
  transcript: string | null;
  errorMessage?: string | null;
}): string | null {
  const s = call.status.toLowerCase();
  if (s === "busy") return "Target number was busy";
  if (s === "no_answer" || s === "no-answer" || s === "no_pickup") return "Target number did not answer";
  if (s === "voicemail") return "Call reached voicemail instead of the agent";
  if (s === "failed" || s === "canceled" || s === "cancelled" || s === "rejected") {
    return call.errorMessage ? `Call failed: ${call.errorMessage}` : "Call failed to connect";
  }
  if (!call.transcript || call.transcript.trim().length < 10) return "Call connected but no conversation was captured";
  return null;
}

/** Last 10 digits — matches +91 / 0 / bare national formats of one Indian number. */
export function phoneLast10(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\D/g, "").slice(-10);
}

export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = phoneLast10(a);
  return x.length === 10 && x === phoneLast10(b);
}

export function clampTestMaxDuration(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TEST_MAX_DURATION_SECONDS;
  return Math.min(MAX_TEST_MAX_DURATION_SECONDS, Math.max(MIN_TEST_MAX_DURATION_SECONDS, n));
}

/** Worst-case cost of one test run: both legs billed for the full max duration. */
export function estimateRunCostCents(opts: {
  maxDurationSeconds: number;
  callerRateCentsPerMin: number;
  targetRateCentsPerMin: number;
}): number {
  const minutes = opts.maxDurationSeconds / 60;
  return Math.ceil(minutes * Math.max(0, opts.callerRateCentsPerMin))
    + Math.ceil(minutes * Math.max(0, opts.targetRateCentsPerMin));
}

/**
 * Which endSession side effects run for a call leg. Test legs keep billing,
 * usage, recording, transcript, latency and the agent success-criteria judge,
 * but never touch real customers, CRMs, memory, webhooks or analytics.
 */
export interface EndSessionSideEffects {
  billing: boolean;
  usageEvents: boolean;
  successCriteriaJudge: boolean;
  disposition: boolean;
  rollingAgentStats: boolean;
  callerMemory: boolean;
  webhooks: boolean;
  campaignHooks: boolean;
  inboundCampaignMatch: boolean;
  afterCallMessaging: boolean;
  sheetsAndCrmPush: boolean;
  flowTriggers: boolean;
  traiOptOutScan: boolean;
  autoRedial: boolean;
  resumeContext: boolean;
  summary: boolean;
}

export function endSessionSideEffects(isTestCall: boolean): EndSessionSideEffects {
  const real = !isTestCall;
  return {
    billing: true,
    usageEvents: true,
    successCriteriaJudge: true,
    disposition: true,
    summary: true,
    rollingAgentStats: real,
    callerMemory: real,
    webhooks: real,
    campaignHooks: real,
    inboundCampaignMatch: real,
    afterCallMessaging: real,
    sheetsAndCrmPush: real,
    flowTriggers: real,
    // A "stop calling me" persona must not put the caller line on the DNC list.
    traiOptOutScan: real,
    autoRedial: real,
    resumeContext: real,
  };
}

/** Options accepted by dialOutboundAgent for a verified AI test run. */
export interface TestRunDialOption {
  runId: number;
  /** Target agent's inbound number, verified as owned by the same user. */
  verifiedOwnNumber: string;
  /** Persist the caller ID before the carrier is hit so the inbound leg can correlate. */
  onBeforeDial?: (fromNumber: string) => Promise<void>;
}

/**
 * DNC + destination OTP are skipped ONLY when the dial is a test run whose
 * destination is the user's own verified number. Anything else keeps the gates.
 */
export function testRunBypassesDestinationGates(
  testRun: TestRunDialOption | undefined,
  toNumber: string,
): boolean {
  if (!testRun) return false;
  if (!Number.isInteger(testRun.runId) || testRun.runId <= 0) return false;
  return samePhone(testRun.verifiedOwnNumber, toNumber);
}

/** Pick a managed caller line that is not the destination (a call to itself is always busy). */
export function pickCallerLine(pool: string[], toNumber: string, preferred?: string | null): string | null {
  const usable = pool.filter((n) => !samePhone(n, toNumber));
  if (usable.length === 0) return null;
  if (preferred && usable.includes(preferred)) return preferred;
  return usable[Math.floor(Math.random() * usable.length)]!;
}

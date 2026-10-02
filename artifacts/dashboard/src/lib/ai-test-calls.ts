/** Shared types + pure helpers for the AI Test Calls panel (real phone-call QA). */

export type TestRunStatus =
  | "queued" | "dialing" | "in_call" | "evaluating" | "passed" | "failed" | "error" | "cancelled";

export interface TestCallsSetup {
  inboundNumber: string | null;
  blocker: { code: string; message: string } | null;
  callerRateCentsPerMin: number;
  targetRateCentsPerMin: number;
  walletBalanceCents: number;
  concurrentLimit: number;
  activeCalls: number;
  slotsPerRun: number;
  defaultMaxDurationSeconds: number;
  estimatedCostCentsDefault: number;
}

export interface TestCaseFields {
  name: string;
  personaPrompt: string;
  goal: string;
  successCriteria: string[];
  language: string | null;
  difficulty: "easy" | "medium" | "hard" | null;
  scenario: string | null;
  callerGender: "female" | "male" | null;
  maxDurationSeconds: number;
}

export interface TestCase extends TestCaseFields {
  id: number;
  agentId: number;
  archived: boolean;
  createdAt: string;
}

export interface TestRunSummary {
  id: number;
  agentId: number;
  testCaseId: number | null;
  testCaseName: string | null;
  batchId: string | null;
  status: TestRunStatus;
  score: number | null;
  verdict: string | null;
  error: string | null;
  costCents: number | null;
  durationSeconds: number | null;
  callerCallId: number | null;
  calleeCallId: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface TestRunLeg {
  callId: number;
  status: string;
  durationSeconds: number | null;
  costCents: number | null;
  transcript: string | null;
  recordingPath: string | null;
  latency: { sttMs: number | null; llmMs: number | null; ttsFirstChunkMs: number | null };
  startedAt: string;
  endedAt: string | null;
}

export interface TestEvaluation {
  score: number;
  verdict: "pass" | "fail";
  criteria: Array<{ criterion: string; pass: boolean; reason: string; evidence: string }>;
  issues: string[];
  summary: string;
}

export interface TestRunDetail extends TestRunSummary {
  testCase: Partial<TestCaseFields> | null;
  evaluation: TestEvaluation | null;
  targetNumber: string | null;
  callerFromNumber: string | null;
  callerLeg: TestRunLeg | null;
  targetLeg: TestRunLeg | null;
}

export const MAX_GENERATE = 10;
export const MAX_RUN_SELECTION = 10;
export const ACTIVE_RUN_STATUSES: TestRunStatus[] = ["queued", "dialing", "in_call", "evaluating"];

export function isActiveRun(status: string): boolean {
  return (ACTIVE_RUN_STATUSES as string[]).includes(status);
}

/** Upper bound: both legs billed at their per-minute rate for the full max duration. */
export function estimateRunCostCents(
  maxDurationSeconds: number,
  rates: Pick<TestCallsSetup, "callerRateCentsPerMin" | "targetRateCentsPerMin">,
): number {
  const minutes = Math.max(0, maxDurationSeconds) / 60;
  return Math.ceil(minutes * Math.max(0, rates.callerRateCentsPerMin))
    + Math.ceil(minutes * Math.max(0, rates.targetRateCentsPerMin));
}

export function formatRupees(cents: number | null | undefined, digits = 2): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return `₹${(cents / 100).toFixed(digits)}`;
}

export function formatDurationShort(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

export const RUN_STATUS_META: Record<TestRunStatus, { label: string; tone: "muted" | "progress" | "good" | "bad" | "warn" }> = {
  queued: { label: "Queued", tone: "muted" },
  dialing: { label: "Dialing", tone: "progress" },
  in_call: { label: "On call", tone: "progress" },
  evaluating: { label: "Grading", tone: "progress" },
  passed: { label: "Passed", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
  error: { label: "Error", tone: "warn" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

export function runStatusMeta(status: string) {
  return RUN_STATUS_META[status as TestRunStatus] ?? { label: status, tone: "muted" as const };
}

export function scoreTone(score: number | null | undefined): "good" | "warn" | "bad" | "muted" {
  if (score == null) return "muted";
  if (score >= 80) return "good";
  if (score >= 50) return "warn";
  return "bad";
}

/** Labels from the TARGET agent's point of view, whichever leg recorded the transcript. */
export function testTranscriptLines(
  transcript: string | null | undefined,
  leg: "target" | "caller",
): Array<{ speaker: "agent" | "persona"; text: string }> {
  if (!transcript) return [];
  const out: Array<{ speaker: "agent" | "persona"; text: string }> = [];
  for (const raw of transcript.split("\n")) {
    const m = raw.match(/^\s*(Agent|Assistant|AI|Caller|User|Customer)\s*:\s*(.*)$/i);
    if (!m) {
      const text = raw.trim();
      if (text && out.length) out[out.length - 1]!.text += ` ${text}`;
      continue;
    }
    const isAgentLabel = /^(agent|assistant|ai)$/i.test(m[1]!);
    const speaker = (leg === "target") === isAgentLabel ? "agent" : "persona";
    if (m[2]!.trim()) out.push({ speaker, text: m[2]!.trim() });
  }
  return out;
}

export function emptyTestCase(defaultMaxDurationSeconds = 300): TestCaseFields {
  return {
    name: "",
    personaPrompt: "",
    goal: "",
    successCriteria: [""],
    language: null,
    difficulty: "medium",
    scenario: "happy_path",
    callerGender: "female",
    maxDurationSeconds: defaultMaxDurationSeconds,
  };
}

/** Client-side mirror of the API's zod limits so Save errors show inline. */
export function validateTestCase(tc: TestCaseFields): string | null {
  if (!tc.name.trim()) return "Give the test a name.";
  if (tc.personaPrompt.trim().length < 10) return "Describe the caller persona (at least 10 characters).";
  if (tc.goal.trim().length < 3) return "Add the caller's goal.";
  const criteria = tc.successCriteria.map((c) => c.trim()).filter(Boolean);
  if (criteria.length === 0) return "Add at least one success criterion.";
  if (criteria.length > 8) return "Use at most 8 success criteria.";
  if (criteria.some((c) => c.length < 3)) return "Each success criterion needs at least 3 characters.";
  return null;
}

export function testCasePayload(tc: TestCaseFields): TestCaseFields {
  return {
    ...tc,
    name: tc.name.trim(),
    personaPrompt: tc.personaPrompt.trim(),
    goal: tc.goal.trim(),
    successCriteria: tc.successCriteria.map((c) => c.trim()).filter(Boolean),
  };
}

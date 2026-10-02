/**
 * AI Test Calls runner: claims queued runs per target agent, dials the hidden
 * persona agent into the target's inbound number, watches both legs via the
 * calls table, then grades the target leg's transcript.
 *
 * State lives in Postgres (simulation_runs), so any replica can claim work.
 * Monitors heartbeat `updated_at`; a run whose monitor died is failed by the
 * stale sweep instead of blocking its agent's queue forever.
 */

import { randomBytes } from "crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  pool,
  agentsTable,
  callsTable,
  simulationRunsTable,
  simulationTestCasesTable,
  type SimulationRun,
  type SimulationTestCase,
} from "@workspace/db";
import { logger } from "../../lib/logger.js";
import { getSelfBaseUrl } from "../../lib/app-domain.js";
import { dialOutboundAgent, OutboundDialError } from "../outbound-agent-dial.js";
import { upsertCallerAgent } from "./caller-agent.js";
import { countActiveCallSlots } from "./preconditions.js";
import { evaluateTestCall, EvaluationUnavailableError, normalizeTestTranscript } from "./evaluator.js";
import {
  ACTIVE_LINE_STATUSES,
  callerLegFailureReason,
  clampTestMaxDuration,
  isLiveCallStatus,
  isTerminalRunStatus,
  MAX_CONCURRENT_RUNS_PER_AGENT,
  phoneLast10,
  SLOTS_PER_RUN,
} from "./policy.js";

const POLL_MS = 3000;
const CALLEE_HANGUP_GRACE_MS = 60_000;
const LATE_LINK_GRACE_MS = 15_000;
const BILLING_SETTLE_MS = 20_000;
const SLOT_WAIT_MS = 120_000;
const STALE_HEARTBEAT_SECONDS = 120;

export interface TestCaseSnapshot {
  name: string;
  goal: string;
  personaPrompt: string;
  successCriteria: string[];
  language: string | null;
  scenario: string | null;
  difficulty: string | null;
  maxDurationSeconds: number;
}

export function snapshotTestCase(tc: SimulationTestCase): TestCaseSnapshot {
  return {
    name: tc.name,
    goal: tc.goal,
    personaPrompt: tc.personaPrompt,
    successCriteria: tc.successCriteria ?? [],
    language: tc.language ?? null,
    scenario: tc.scenario ?? null,
    difficulty: tc.difficulty ?? null,
    maxDurationSeconds: clampTestMaxDuration(tc.maxDurationSeconds),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function webhookBaseUrl(): string {
  return (process.env["WEBHOOK_BASE_URL"] || getSelfBaseUrl()).replace(/\/+$/, "");
}

async function patchRun(runId: number, set: Partial<typeof simulationRunsTable.$inferInsert>): Promise<void> {
  await db.update(simulationRunsTable).set({ ...set, updatedAt: new Date() }).where(eq(simulationRunsTable.id, runId));
}

/** Finish a run unless it was already finished (e.g. cancelled meanwhile). */
async function finishRun(runId: number, set: Partial<typeof simulationRunsTable.$inferInsert>): Promise<void> {
  await db.update(simulationRunsTable)
    .set({ ...set, completedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(simulationRunsTable.id, runId),
      sql`${simulationRunsTable.status} NOT IN ('passed','failed','error','cancelled')`,
    ));
}

export async function enqueueTestRuns(opts: {
  userId: string;
  createdBy: string;
  targetAgentId: number;
  targetNumber: string;
  testCases: SimulationTestCase[];
}): Promise<SimulationRun[]> {
  const batchId = `tb_${randomBytes(6).toString("hex")}`;
  const rows = await db.insert(simulationRunsTable).values(opts.testCases.map((tc) => ({
    agentId: opts.targetAgentId,
    testCaseId: tc.id,
    userId: opts.userId,
    createdBy: opts.createdBy,
    status: "queued",
    batchId,
    targetNumber: opts.targetNumber,
    testCaseSnapshot: snapshotTestCase(tc),
  }))).returning();
  kickAgentQueue(opts.targetAgentId);
  return rows;
}

/** Runs whose monitor stopped heartbeating (process restart) are failed, not left blocking. */
export async function sweepStaleRuns(agentId?: number): Promise<number> {
  const rows = await db.update(simulationRunsTable)
    .set({
      status: "error",
      error: "Monitoring was interrupted (server restart). Check the calls in Call History.",
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      inArray(simulationRunsTable.status, ["dialing", "in_call", "evaluating"]),
      sql`coalesce(${simulationRunsTable.updatedAt}, ${simulationRunsTable.createdAt}) < now() - make_interval(secs => ${STALE_HEARTBEAT_SECONDS})`,
      ...(agentId != null ? [eq(simulationRunsTable.agentId, agentId)] : []),
    ))
    .returning({ id: simulationRunsTable.id });
  return rows.length;
}

/** Atomically move the next queued run to `dialing` when the agent has a free test lane. */
async function claimNextRun(agentId: number): Promise<number | null> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`ai-test-runs:${agentId}`]);
    const active = await c.query(
      "SELECT count(*)::int AS n FROM simulation_runs WHERE agent_id=$1 AND status = ANY($2::text[])",
      [agentId, ACTIVE_LINE_STATUSES],
    );
    if (Number(active.rows[0]?.n ?? 0) >= MAX_CONCURRENT_RUNS_PER_AGENT) {
      await c.query("COMMIT");
      return null;
    }
    const claimed = await c.query(
      `UPDATE simulation_runs SET status='dialing', started_at=now(), updated_at=now()
       WHERE id = (SELECT id FROM simulation_runs WHERE agent_id=$1 AND status='queued'
                   ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING id`,
      [agentId],
    );
    await c.query("COMMIT");
    return claimed.rows[0]?.id ?? null;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

const runningQueues = new Set<number>();

export function kickAgentQueue(agentId: number): void {
  if (runningQueues.has(agentId)) return;
  runningQueues.add(agentId);
  void (async () => {
    try {
      await sweepStaleRuns(agentId);
      for (;;) {
        const runId = await claimNextRun(agentId);
        if (runId == null) break;
        await executeRun(runId).catch(async (err) => {
          logger.error({ err, runId }, "ai-test-calls: run crashed");
          await finishRun(runId, { status: "error", error: "Internal error while running the test" });
        });
      }
    } catch (err) {
      logger.error({ err, agentId }, "ai-test-calls: queue loop failed");
    } finally {
      runningQueues.delete(agentId);
    }
  })();
}

/** Boot hook: fail orphaned runs and resume queues that still have work. */
export async function recoverTestRuns(): Promise<void> {
  const swept = await sweepStaleRuns();
  const queued = await db
    .selectDistinct({ agentId: simulationRunsTable.agentId })
    .from(simulationRunsTable)
    .where(eq(simulationRunsTable.status, "queued"));
  for (const { agentId } of queued) kickAgentQueue(agentId);
  if (swept || queued.length) logger.info({ swept, queuedAgents: queued.length }, "ai-test-calls: recovered runs");
}

async function loadRun(runId: number): Promise<SimulationRun | undefined> {
  const [run] = await db.select().from(simulationRunsTable).where(eq(simulationRunsTable.id, runId));
  return run;
}

async function loadCall(callId: number | null | undefined) {
  if (!callId) return undefined;
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, callId));
  return call;
}

async function waitForSlots(userId: string): Promise<boolean> {
  const [user] = await db.execute(sql`SELECT concurrent_limit FROM users WHERE clerk_id = ${userId}`)
    .then((r) => (r as unknown as { rows: Array<{ concurrent_limit: number }> }).rows);
  const limit = user?.concurrent_limit ?? 10;
  const deadline = Date.now() + SLOT_WAIT_MS;
  while (Date.now() < deadline) {
    if ((await countActiveCallSlots(userId)) + SLOTS_PER_RUN <= limit) return true;
    await sleep(5000);
  }
  return false;
}

async function executeRun(runId: number): Promise<void> {
  const run = await loadRun(runId);
  if (!run || run.status !== "dialing") return;
  const snapshot = run.testCaseSnapshot as TestCaseSnapshot | null;
  const [target] = await db.select().from(agentsTable).where(eq(agentsTable.id, run.agentId));
  const [testCase] = run.testCaseId
    ? await db.select().from(simulationTestCasesTable).where(eq(simulationTestCasesTable.id, run.testCaseId))
    : [];
  if (!target || !snapshot || !testCase || !run.targetNumber) {
    await finishRun(runId, { status: "error", error: "Test case or agent no longer exists" });
    return;
  }

  if (!(await waitForSlots(run.userId))) {
    await finishRun(runId, { status: "error", error: "No free call slots — too many calls in progress" });
    return;
  }

  const callerAgentId = await upsertCallerAgent({
    target,
    testCase: { ...testCase, maxDurationSeconds: snapshot.maxDurationSeconds },
    targetNumber: run.targetNumber,
  });
  await patchRun(runId, { callerAgentId });

  let callerCallId: number;
  try {
    const dialed = await dialOutboundAgent({
      userId: run.userId,
      agentId: callerAgentId,
      toNumber: run.targetNumber,
      webhookBaseUrl: webhookBaseUrl(),
      metadata: { source: "ai_test_call", testRunId: runId },
      testRun: {
        runId,
        verifiedOwnNumber: run.targetNumber,
        onBeforeDial: async (fromNumber) => {
          await patchRun(runId, { callerFromNumber: fromNumber, dialStartedAt: new Date() });
        },
      },
    });
    callerCallId = dialed.callId;
  } catch (err) {
    const msg = err instanceof OutboundDialError || err instanceof Error ? err.message : String(err);
    await finishRun(runId, { status: "error", error: `Could not place the test call: ${msg}` });
    return;
  }
  await patchRun(runId, { callerCallId });
  await monitorAndEvaluate(runId, snapshot, target);
}

async function monitorAndEvaluate(
  runId: number,
  snapshot: TestCaseSnapshot,
  target: typeof agentsTable.$inferSelect,
): Promise<void> {
  const hardDeadline = Date.now() + (snapshot.maxDurationSeconds + 180) * 1000;
  let callerEndedAt: number | null = null;

  for (;;) {
    await sleep(POLL_MS);
    const run = await loadRun(runId);
    if (!run || isTerminalRunStatus(run.status)) return;
    await patchRun(runId, {});
    const caller = await loadCall(run.callerCallId);
    const callee = await loadCall(run.calleeCallId);

    if (run.status === "dialing" && (callee || caller?.status === "in_progress")) {
      await patchRun(runId, { status: "in_call" });
    }

    const callerLive = !caller || isLiveCallStatus(caller.status);
    if (!callerLive && callerEndedAt == null) callerEndedAt = Date.now();

    if (callerEndedAt != null) {
      const calleeLive = callee ? isLiveCallStatus(callee.status) : false;
      const waited = Date.now() - callerEndedAt;
      if (callee && (!calleeLive || waited >= CALLEE_HANGUP_GRACE_MS)) break;
      if (!callee && waited >= LATE_LINK_GRACE_MS) break;
    }

    if (Date.now() > hardDeadline) {
      await cancelLiveLegs(run);
      await finishRun(runId, { status: "error", error: "Test call did not finish within its time limit" });
      return;
    }
  }

  let run = await loadRun(runId);
  if (!run || isTerminalRunStatus(run.status)) return;
  if (!run.calleeCallId) await linkCalleeLate(run);
  run = (await loadRun(runId))!;
  await patchRun(runId, { status: "evaluating" });

  const caller = await loadCall(run.callerCallId);
  const callee = await loadCall(run.calleeCallId);
  const costCents = await settledCostCents([run.callerCallId, run.calleeCallId]);

  const calleeTranscript = callee?.transcript?.trim() ?? "";
  const callerTranscript = caller?.transcript?.trim() ?? "";
  const source: "callee" | "caller" | null = calleeTranscript.length >= 10
    ? "callee"
    : callerTranscript.length >= 10 ? "caller" : null;

  if (!source) {
    const reason = caller ? callerLegFailureReason(caller) : "Test call was never created";
    await finishRun(runId, { status: "error", error: reason ?? "No conversation was captured", costCents });
    return;
  }

  const transcript = normalizeTestTranscript(source === "callee" ? calleeTranscript : callerTranscript, source);
  const latency = callee
    ? { sttMs: callee.sttLatencyMs, llmMs: callee.llmLatencyMs, ttsMs: callee.ttsFirstChunkMs }
    : undefined;
  const agentSuccessCriteria = (target.agentConfig as { successCriteria?: string } | null)?.successCriteria ?? null;

  try {
    const evaluation = await evaluateTestCall({
      transcript,
      goal: snapshot.goal,
      criteria: snapshot.successCriteria,
      agentSuccessCriteria,
      latency,
    });
    await finishRun(runId, {
      status: evaluation.verdict === "pass" ? "passed" : "failed",
      score: evaluation.score,
      verdict: evaluation.verdict,
      costCents,
      result: {
        ...evaluation,
        transcriptSource: source,
        calleeLinked: !!callee,
        latency: latency ?? null,
        durationSeconds: callee?.durationSeconds ?? caller?.durationSeconds ?? null,
      },
    });
  } catch (err) {
    const message = err instanceof EvaluationUnavailableError ? err.message : "Evaluation unavailable";
    if (!(err instanceof EvaluationUnavailableError)) logger.error({ err, runId }, "ai-test-calls: evaluation crashed");
    await finishRun(runId, {
      status: "error",
      error: message,
      costCents,
      result: { transcriptSource: source, calleeLinked: !!callee, latency: latency ?? null },
    });
  }
}

/**
 * Fallback when the live correlation missed (e.g. carrier rewrote the caller
 * ID format past last-10 matching, or the inbound row was created on a path
 * without the hook). Side effects on that leg already ran; this only links it
 * for grading.
 */
async function linkCalleeLate(run: SimulationRun): Promise<void> {
  if (!run.callerFromNumber || !run.dialStartedAt) return;
  const from10 = phoneLast10(run.callerFromNumber);
  const [candidate] = await db
    .select({ id: callsTable.id })
    .from(callsTable)
    .where(and(
      eq(callsTable.agentId, run.agentId),
      isNull(callsTable.testRunId),
      sql`${callsTable.createdAt} >= ${new Date(run.dialStartedAt.getTime() - 5000)}`,
      sql`right(regexp_replace(${callsTable.fromNumber}, '[^0-9]', '', 'g'), 10) = ${from10}`,
    ))
    .orderBy(callsTable.createdAt)
    .limit(1);
  if (!candidate) return;
  const claimed = await db.update(simulationRunsTable)
    .set({ calleeCallId: candidate.id, updatedAt: new Date() })
    .where(and(eq(simulationRunsTable.id, run.id), isNull(simulationRunsTable.calleeCallId)))
    .returning({ id: simulationRunsTable.id });
  if (claimed.length === 0) return;
  await db.update(callsTable).set({ isTest: true, testRunId: run.id }).where(eq(callsTable.id, candidate.id));
  logger.warn({ runId: run.id, callId: candidate.id }, "ai-test-calls: inbound leg linked late (side effects were not suppressed)");
}

/** Billing is written by endSession shortly after the status flip — give it a moment. */
async function settledCostCents(callIds: Array<number | null>): Promise<number | null> {
  const ids = callIds.filter((x): x is number => typeof x === "number");
  if (ids.length === 0) return null;
  const deadline = Date.now() + BILLING_SETTLE_MS;
  for (;;) {
    const rows = await db
      .select({ costCents: callsTable.costCents, durationSeconds: callsTable.durationSeconds, status: callsTable.status })
      .from(callsTable)
      .where(inArray(callsTable.id, ids));
    const pending = rows.some((r) => (r.durationSeconds ?? 0) > 0 && r.costCents == null && !isLiveCallStatus(r.status));
    if (!pending || Date.now() > deadline) {
      return rows.reduce((s, r) => s + (r.costCents ?? 0), 0);
    }
    await sleep(2000);
  }
}

async function hangupLeg(call: typeof callsTable.$inferSelect): Promise<void> {
  if (!isLiveCallStatus(call.status)) return;
  const { getSessionByCallId, endSession } = await import("../../orchestration/session.js");
  const session = getSessionByCallId(call.id);
  if (session) {
    await endSession(session.sessionId, "test_cancelled").catch((err) =>
      logger.warn({ err, callId: call.id }, "ai-test-calls: local session end failed"));
  }
  let meta: Record<string, unknown> = {};
  try { meta = call.metadata ? JSON.parse(call.metadata) as Record<string, unknown> : {}; } catch { /* ignore */ }
  const callUuid = String(meta["externalCallId"] ?? meta["providerCallId"] ?? "");
  const provider = String(meta["provider"] ?? "vobiz");
  if (callUuid.length >= 20 && provider === "vobiz" && call.userId) {
    try {
      const { resolveVobizCredsForUser } = await import("../../routes/webhooks.js");
      const { hangupVobizCall } = await import("../../orchestration/telephony/transfer.js");
      const creds = await resolveVobizCredsForUser(call.userId);
      if (creds) await hangupVobizCall({ ...creds, callUuid });
    } catch (err) {
      logger.warn({ err, callId: call.id }, "ai-test-calls: carrier hangup failed");
    }
  }
}

async function cancelLiveLegs(run: SimulationRun): Promise<void> {
  for (const id of [run.callerCallId, run.calleeCallId]) {
    const call = await loadCall(id);
    if (call) await hangupLeg(call);
  }
}

export async function cancelTestRun(runId: number): Promise<SimulationRun | null> {
  const [cancelled] = await db.update(simulationRunsTable)
    .set({ status: "cancelled", error: "Cancelled by user", completedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(simulationRunsTable.id, runId),
      sql`${simulationRunsTable.status} NOT IN ('passed','failed','error','cancelled')`,
    ))
    .returning();
  if (!cancelled) return null;
  await cancelLiveLegs(cancelled);
  return cancelled;
}

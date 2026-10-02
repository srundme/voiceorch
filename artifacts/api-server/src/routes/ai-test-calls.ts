/**
 * AI Test Calls — AI-to-AI testing over real phone calls.
 * A hidden persona agent phones the target agent's own inbound number; both
 * legs are billed at the normal per-minute rate.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  agentsTable,
  callsTable,
  kbChunksTable,
  simulationRunsTable,
  simulationTestCasesTable,
  type SimulationRun,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext } from "../middlewares/clientContext.js";
import { resolveWorkspaceScope } from "../services/workspace-scope.js";
import { generatePersonaDrafts, PersonaGenerationError } from "../services/ai-test-calls/personas.js";
import {
  checkRunPreconditions,
  countActiveCallSlots,
  defaultPreconditionDeps,
  personaBillingShape,
  pickTestableInboundNumber,
  resolveAgentRateCentsPerMin,
  TestRunPreconditionError,
} from "../services/ai-test-calls/preconditions.js";
import { cancelTestRun, enqueueTestRuns, kickAgentQueue, sweepStaleRuns } from "../services/ai-test-calls/runner.js";
import {
  clampTestMaxDuration,
  DEFAULT_TEST_MAX_DURATION_SECONDS,
  estimateRunCostCents,
  MAX_RUNS_PER_REQUEST,
  MAX_TEST_CASES_PER_GENERATE,
  SLOTS_PER_RUN,
} from "../services/ai-test-calls/policy.js";

const router: IRouter = Router();

function clerkIdOf(req: Request): string {
  return (req as unknown as { clerkUserId: string }).clerkUserId;
}

function intParam(raw: unknown): number | null {
  const n = Number.parseInt(String(Array.isArray(raw) ? raw[0] : raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Target agent visible to this workspace (hidden persona agents are never targets). */
async function loadTargetAgent(req: Request, res: Response, opts: { write?: boolean } = {}) {
  const agentId = intParam(req.params["id"]);
  if (!agentId) { res.status(400).json({ error: "Invalid agent id" }); return null; }
  const scope = await resolveWorkspaceScope(clerkIdOf(req));
  const [agent] = await db.select().from(agentsTable).where(and(
    eq(agentsTable.id, agentId),
    inArray(agentsTable.userId, scope.userIds),
    eq(agentsTable.isTestPersona, false),
  ));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return null; }
  if (opts.write && !scope.canWrite) { res.status(403).json({ error: "Your team role cannot run test calls" }); return null; }
  return agent;
}

const caseInput = z.object({
  name: z.string().trim().min(1).max(120),
  personaPrompt: z.string().trim().min(10).max(2000),
  goal: z.string().trim().min(3).max(500),
  successCriteria: z.array(z.string().trim().min(3).max(300)).min(1).max(8),
  language: z.string().trim().max(10).nullish(),
  difficulty: z.enum(["easy", "medium", "hard"]).nullish(),
  scenario: z.string().trim().max(40).nullish(),
  callerGender: z.enum(["female", "male"]).nullish(),
  maxDurationSeconds: z.number().int().positive().nullish(),
});

function caseValues(input: z.infer<typeof caseInput>) {
  return {
    name: input.name,
    personaPrompt: input.personaPrompt,
    goal: input.goal,
    successCriteria: input.successCriteria,
    language: input.language ?? null,
    difficulty: input.difficulty ?? null,
    scenario: input.scenario ?? null,
    callerGender: input.callerGender ?? null,
    maxDurationSeconds: clampTestMaxDuration(input.maxDurationSeconds ?? DEFAULT_TEST_MAX_DURATION_SECONDS),
  };
}

/* ── Setup: inbound number, rates, estimate ───────────────────────────────── */

router.get("/agents/:id/test-calls/setup", requireAuth, clientContext, async (req, res): Promise<void> => {
  const agent = await loadTargetAgent(req, res);
  if (!agent) return;
  const userId = agent.userId!;
  let inboundNumber: string | null = null;
  let blocker: { code: string; message: string } | null = null;
  try {
    inboundNumber = pickTestableInboundNumber(await defaultPreconditionDeps.findInboundNumbers(agent.id), userId).number;
  } catch (err) {
    if (err instanceof TestRunPreconditionError) blocker = { code: err.code, message: err.message };
    else throw err;
  }
  const [callerRate, targetRate, wallet, limit, active] = await Promise.all([
    resolveAgentRateCentsPerMin(userId, personaBillingShape(agent)),
    resolveAgentRateCentsPerMin(userId, agent),
    defaultPreconditionDeps.walletBalanceCents(userId),
    defaultPreconditionDeps.concurrentLimit(userId),
    countActiveCallSlots(userId),
  ]);
  res.json({
    inboundNumber,
    blocker,
    callerRateCentsPerMin: callerRate,
    targetRateCentsPerMin: targetRate,
    walletBalanceCents: wallet ?? 0,
    concurrentLimit: limit,
    activeCalls: active,
    slotsPerRun: SLOTS_PER_RUN,
    defaultMaxDurationSeconds: DEFAULT_TEST_MAX_DURATION_SECONDS,
    estimatedCostCentsDefault: estimateRunCostCents({
      maxDurationSeconds: DEFAULT_TEST_MAX_DURATION_SECONDS,
      callerRateCentsPerMin: callerRate,
      targetRateCentsPerMin: targetRate,
    }),
  });
});

/* ── Test cases ───────────────────────────────────────────────────────────── */

router.post("/agents/:id/test-cases/generate", requireAuth, clientContext, async (req, res): Promise<void> => {
  const agent = await loadTargetAgent(req, res, { write: true });
  if (!agent) return;
  const count = Math.min(MAX_TEST_CASES_PER_GENERATE, Math.max(1, Number(req.body?.count) || 5));
  const knowledgeSnippets = agent.knowledgeBaseId
    ? (await db.select({ content: kbChunksTable.content }).from(kbChunksTable)
      .where(eq(kbChunksTable.knowledgeBaseId, agent.knowledgeBaseId))
      .orderBy(kbChunksTable.chunkIndex)
      .limit(6)).map((c) => c.content.slice(0, 600))
    : [];
  try {
    const drafts = await generatePersonaDrafts({
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      greetingMessage: agent.greetingMessage,
      language: agent.language,
      productDetails: agent.productDetails,
      successCriteria: (agent.agentConfig as { successCriteria?: string } | null)?.successCriteria ?? null,
      knowledgeSnippets,
    }, count);
    res.json({ drafts });
  } catch (err) {
    if (err instanceof PersonaGenerationError) { res.status(503).json({ error: err.message }); return; }
    throw err;
  }
});

router.get("/agents/:id/test-cases", requireAuth, clientContext, async (req, res): Promise<void> => {
  const agent = await loadTargetAgent(req, res);
  if (!agent) return;
  const includeArchived = req.query["includeArchived"] === "1";
  const rows = await db.select().from(simulationTestCasesTable)
    .where(and(
      eq(simulationTestCasesTable.agentId, agent.id),
      ...(includeArchived ? [] : [eq(simulationTestCasesTable.archived, false)]),
    ))
    .orderBy(desc(simulationTestCasesTable.createdAt));
  res.json({ testCases: rows });
});

router.post("/agents/:id/test-cases", requireAuth, clientContext, async (req, res): Promise<void> => {
  const agent = await loadTargetAgent(req, res, { write: true });
  if (!agent) return;
  const parsed = z.object({ testCases: z.array(caseInput).min(1).max(20) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  const rows = await db.insert(simulationTestCasesTable).values(parsed.data.testCases.map((tc) => ({
    ...caseValues(tc),
    agentId: agent.id,
    userId: agent.userId!,
    createdBy: clerkIdOf(req),
  }))).returning();
  res.status(201).json({ testCases: rows });
});

async function loadOwnedTestCase(req: Request, res: Response) {
  const caseId = intParam(req.params["caseId"]);
  if (!caseId) { res.status(400).json({ error: "Invalid test case id" }); return null; }
  const scope = await resolveWorkspaceScope(clerkIdOf(req));
  const [tc] = await db.select().from(simulationTestCasesTable).where(and(
    eq(simulationTestCasesTable.id, caseId),
    inArray(simulationTestCasesTable.userId, scope.userIds),
  ));
  if (!tc) { res.status(404).json({ error: "Test case not found" }); return null; }
  if (!scope.canWrite) { res.status(403).json({ error: "Your team role cannot edit test cases" }); return null; }
  return tc;
}

router.patch("/test-cases/:caseId", requireAuth, clientContext, async (req, res): Promise<void> => {
  const tc = await loadOwnedTestCase(req, res);
  if (!tc) return;
  const parsed = caseInput.partial().extend({ archived: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  const d = parsed.data;
  const set: Partial<typeof simulationTestCasesTable.$inferInsert> = {};
  if (d.name !== undefined) set.name = d.name;
  if (d.personaPrompt !== undefined) set.personaPrompt = d.personaPrompt;
  if (d.goal !== undefined) set.goal = d.goal;
  if (d.successCriteria !== undefined) set.successCriteria = d.successCriteria;
  if (d.language !== undefined) set.language = d.language ?? null;
  if (d.difficulty !== undefined) set.difficulty = d.difficulty ?? null;
  if (d.scenario !== undefined) set.scenario = d.scenario ?? null;
  if (d.callerGender !== undefined) set.callerGender = d.callerGender ?? null;
  if (d.maxDurationSeconds !== undefined) set.maxDurationSeconds = clampTestMaxDuration(d.maxDurationSeconds);
  if (d.archived !== undefined) set.archived = d.archived;
  const [row] = await db.update(simulationTestCasesTable).set(set)
    .where(eq(simulationTestCasesTable.id, tc.id)).returning();
  res.json({ testCase: row });
});

/** Archive (runs keep their snapshot and call records). */
router.delete("/test-cases/:caseId", requireAuth, clientContext, async (req, res): Promise<void> => {
  const tc = await loadOwnedTestCase(req, res);
  if (!tc) return;
  await db.update(simulationTestCasesTable).set({ archived: true }).where(eq(simulationTestCasesTable.id, tc.id));
  res.json({ ok: true });
});

/* ── Runs ─────────────────────────────────────────────────────────────────── */

router.post("/agents/:id/test-runs", requireAuth, clientContext, async (req, res): Promise<void> => {
  const agent = await loadTargetAgent(req, res, { write: true });
  if (!agent) return;
  const parsed = z.object({
    testCaseIds: z.array(z.number().int().positive()).min(1).max(MAX_RUNS_PER_REQUEST),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: `Pick between 1 and ${MAX_RUNS_PER_REQUEST} test cases`, issues: parsed.error.issues });
    return;
  }
  const ids = [...new Set(parsed.data.testCaseIds)];
  const cases = await db.select().from(simulationTestCasesTable).where(and(
    inArray(simulationTestCasesTable.id, ids),
    eq(simulationTestCasesTable.agentId, agent.id),
    eq(simulationTestCasesTable.archived, false),
  ));
  if (cases.length !== ids.length) {
    res.status(400).json({ error: "Some test cases were not found or are archived" });
    return;
  }
  try {
    const setup = await checkRunPreconditions({
      target: agent,
      maxDurations: cases.map((c) => clampTestMaxDuration(c.maxDurationSeconds)),
    });
    const runs = await enqueueTestRuns({
      userId: agent.userId!,
      createdBy: clerkIdOf(req),
      targetAgentId: agent.id,
      targetNumber: setup.inboundNumber.number,
      testCases: ids.map((id) => cases.find((c) => c.id === id)!),
    });
    res.status(202).json({ runs: runs.map((r) => serializeRun(r)), estimatedCostCents: setup.estimatedCostCents });
  } catch (err) {
    if (err instanceof TestRunPreconditionError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
});

type CallLite = Pick<typeof callsTable.$inferSelect,
  "id" | "status" | "durationSeconds" | "costCents" | "transcript" | "recordingUrl" |
  "sttLatencyMs" | "llmLatencyMs" | "ttsFirstChunkMs" | "createdAt" | "endedAt">;

function serializeRun(run: SimulationRun, calls: Map<number, CallLite> = new Map()) {
  const caller = run.callerCallId ? calls.get(run.callerCallId) : undefined;
  const callee = run.calleeCallId ? calls.get(run.calleeCallId) : undefined;
  const liveCost = (caller?.costCents ?? 0) + (callee?.costCents ?? 0);
  const snapshot = (run.testCaseSnapshot ?? {}) as { name?: string };
  return {
    id: run.id,
    agentId: run.agentId,
    testCaseId: run.testCaseId,
    testCaseName: snapshot.name ?? null,
    batchId: run.batchId,
    status: run.status,
    score: run.score,
    verdict: run.verdict,
    error: run.error,
    costCents: run.costCents ?? (caller || callee ? liveCost : null),
    durationSeconds: callee?.durationSeconds ?? caller?.durationSeconds ?? null,
    callerCallId: run.callerCallId,
    calleeCallId: run.calleeCallId,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}

async function callsById(ids: Array<number | null | undefined>): Promise<Map<number, CallLite>> {
  const clean = [...new Set(ids.filter((x): x is number => typeof x === "number"))];
  if (clean.length === 0) return new Map();
  const rows = await db.select({
    id: callsTable.id,
    status: callsTable.status,
    durationSeconds: callsTable.durationSeconds,
    costCents: callsTable.costCents,
    transcript: callsTable.transcript,
    recordingUrl: callsTable.recordingUrl,
    sttLatencyMs: callsTable.sttLatencyMs,
    llmLatencyMs: callsTable.llmLatencyMs,
    ttsFirstChunkMs: callsTable.ttsFirstChunkMs,
    createdAt: callsTable.createdAt,
    endedAt: callsTable.endedAt,
  }).from(callsTable).where(inArray(callsTable.id, clean));
  return new Map(rows.map((r) => [r.id, r]));
}

router.get("/agents/:id/test-runs", requireAuth, clientContext, async (req, res): Promise<void> => {
  const agent = await loadTargetAgent(req, res);
  if (!agent) return;
  await sweepStaleRuns(agent.id);
  const runs = await db.select().from(simulationRunsTable)
    .where(eq(simulationRunsTable.agentId, agent.id))
    .orderBy(desc(simulationRunsTable.createdAt))
    .limit(100);
  if (runs.some((r) => r.status === "queued")) kickAgentQueue(agent.id);
  const calls = await callsById(runs.flatMap((r) => [r.callerCallId, r.calleeCallId]));
  res.json({ runs: runs.map((r) => serializeRun(r, calls)) });
});

async function loadOwnedRun(req: Request, res: Response) {
  const runId = intParam(req.params["runId"]);
  if (!runId) { res.status(400).json({ error: "Invalid run id" }); return null; }
  const scope = await resolveWorkspaceScope(clerkIdOf(req));
  const [run] = await db.select().from(simulationRunsTable).where(and(
    eq(simulationRunsTable.id, runId),
    inArray(simulationRunsTable.userId, scope.userIds),
  ));
  if (!run) { res.status(404).json({ error: "Test run not found" }); return null; }
  return { run, scope };
}

function legDetail(call: CallLite | undefined) {
  if (!call) return null;
  return {
    callId: call.id,
    status: call.status,
    durationSeconds: call.durationSeconds,
    costCents: call.costCents,
    transcript: call.transcript,
    // Served through the authenticated recording endpoint (workspace-scoped).
    recordingPath: call.recordingUrl ? `/api/storage/recordings/${call.id}` : null,
    latency: { sttMs: call.sttLatencyMs, llmMs: call.llmLatencyMs, ttsFirstChunkMs: call.ttsFirstChunkMs },
    startedAt: call.createdAt.toISOString(),
    endedAt: call.endedAt?.toISOString() ?? null,
  };
}

router.get("/test-runs/:runId", requireAuth, clientContext, async (req, res): Promise<void> => {
  const owned = await loadOwnedRun(req, res);
  if (!owned) return;
  const { run } = owned;
  const calls = await callsById([run.callerCallId, run.calleeCallId]);
  res.json({
    run: {
      ...serializeRun(run, calls),
      testCase: run.testCaseSnapshot,
      evaluation: run.result,
      targetNumber: run.targetNumber,
      callerFromNumber: run.callerFromNumber,
      callerLeg: legDetail(run.callerCallId ? calls.get(run.callerCallId) : undefined),
      targetLeg: legDetail(run.calleeCallId ? calls.get(run.calleeCallId) : undefined),
    },
  });
});

router.post("/test-runs/:runId/cancel", requireAuth, clientContext, async (req, res): Promise<void> => {
  const owned = await loadOwnedRun(req, res);
  if (!owned) return;
  if (!owned.scope.canWrite) { res.status(403).json({ error: "Your team role cannot cancel test calls" }); return; }
  const cancelled = await cancelTestRun(owned.run.id);
  if (!cancelled) { res.status(409).json({ error: "This test run has already finished" }); return; }
  res.json({ run: serializeRun(cancelled) });
});

export default router;

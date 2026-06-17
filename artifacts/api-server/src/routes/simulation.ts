import { Router } from "express";
import type { Request, Response } from "express";
import { db } from "@workspace/db";
import {
  simulationTestCasesTable,
  simulationRunsTable,
  simulationMessagesTable,
  agentsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { runChatTurn } from "../services/simulation/chat.js";
import { runScenario } from "../services/simulation/scenario-runner.js";
import { HEALTH_INSURANCE_TEMPLATES } from "../services/simulation/templates.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.use(requireAuth);

function getUserId(req: Request): string {
  return (req as any).clerkUserId as string;
}

async function assertAgentOwnership(agentId: number, userId: string): Promise<boolean> {
  const [agent] = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, userId)));
  return !!agent;
}

// ── POST /simulation/runs/chat ─────────────────────────────────────────────────
// SSE — streams agent tokens + debug events for a single manual chat turn

router.post("/simulation/runs/chat", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const { agent_id, run_id, message } = req.body as {
    agent_id?: number;
    run_id?: number | null;
    message?: string;
  };

  if (!agent_id || !message?.trim()) {
    res.status(400).json({ error: "agent_id and message are required" });
    return;
  }

  const owns = await assertAgentOwnership(agent_id, userId);
  if (!owns) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  function send(event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    const result = await runChatTurn(
      agent_id,
      userId,
      run_id ?? null,
      message,
      (token) => send("agent_token", { token }),
      (debug) => send("debug_info", debug),
    );
    send("done", { run_id: result.runId, debug: result.debug });
  } catch (err) {
    logger.error({ err, agent_id }, "simulation chat turn failed");
    send("error", { error: String(err) });
  } finally {
    res.end();
  }
});

// ── GET /simulation/test-cases?agent_id= ──────────────────────────────────────

router.get("/simulation/test-cases", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const agentId = Number(req.query["agent_id"]);

  if (!agentId) {
    res.status(400).json({ error: "agent_id query param required" });
    return;
  }

  const owns = await assertAgentOwnership(agentId, userId);
  if (!owns) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const cases = await db
    .select()
    .from(simulationTestCasesTable)
    .where(and(eq(simulationTestCasesTable.agentId, agentId), eq(simulationTestCasesTable.userId, userId)))
    .orderBy(desc(simulationTestCasesTable.createdAt));

  const runsMap: Record<number, { status: string; score: number | null; createdAt: Date }> = {};
  for (const tc of cases) {
    const [lastRun] = await db
      .select({ status: simulationRunsTable.status, score: simulationRunsTable.score, createdAt: simulationRunsTable.createdAt })
      .from(simulationRunsTable)
      .where(eq(simulationRunsTable.testCaseId, tc.id))
      .orderBy(desc(simulationRunsTable.createdAt))
      .limit(1);
    if (lastRun) runsMap[tc.id] = lastRun;
  }

  const result = cases.map((tc) => ({
    ...tc,
    lastRun: runsMap[tc.id] ?? null,
  }));

  res.json(result);
});

// ── POST /simulation/test-cases ───────────────────────────────────────────────

router.post("/simulation/test-cases", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const { agent_id, name, persona_prompt, goal, success_criteria, variables, kb_source_id, max_turns } = req.body as {
    agent_id?: number;
    name?: string;
    persona_prompt?: string;
    goal?: string;
    success_criteria?: string[];
    variables?: Record<string, unknown>;
    kb_source_id?: number | null;
    max_turns?: number;
  };

  if (!agent_id || !name?.trim() || !persona_prompt?.trim() || !goal?.trim()) {
    res.status(400).json({ error: "agent_id, name, persona_prompt, and goal are required" });
    return;
  }

  const owns = await assertAgentOwnership(agent_id, userId);
  if (!owns) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const [created] = await db
    .insert(simulationTestCasesTable)
    .values({
      agentId: agent_id,
      userId,
      name,
      personaPrompt: persona_prompt,
      goal,
      successCriteria: success_criteria ?? [],
      variables: variables ?? null,
      kbSourceId: kb_source_id ?? null,
      maxTurns: max_turns ?? 20,
    })
    .returning();

  res.status(201).json(created);
});

// ── PATCH /simulation/test-cases/:id ──────────────────────────────────────────

router.patch("/simulation/test-cases/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const id = Number(req.params["id"]);

  const [tc] = await db
    .select()
    .from(simulationTestCasesTable)
    .where(and(eq(simulationTestCasesTable.id, id), eq(simulationTestCasesTable.userId, userId)));

  if (!tc) {
    res.status(404).json({ error: "Test case not found" });
    return;
  }

  const { name, persona_prompt, goal, success_criteria, variables, kb_source_id, max_turns } = req.body as {
    name?: string;
    persona_prompt?: string;
    goal?: string;
    success_criteria?: string[];
    variables?: Record<string, unknown> | null;
    kb_source_id?: number | null;
    max_turns?: number;
  };

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates["name"] = name;
  if (persona_prompt !== undefined) updates["personaPrompt"] = persona_prompt;
  if (goal !== undefined) updates["goal"] = goal;
  if (success_criteria !== undefined) updates["successCriteria"] = success_criteria;
  if (variables !== undefined) updates["variables"] = variables;
  if (kb_source_id !== undefined) updates["kbSourceId"] = kb_source_id;
  if (max_turns !== undefined) updates["maxTurns"] = max_turns;

  if (Object.keys(updates).length === 0) {
    res.json(tc);
    return;
  }

  const [updated] = await db
    .update(simulationTestCasesTable)
    .set(updates as any)
    .where(eq(simulationTestCasesTable.id, id))
    .returning();

  res.json(updated);
});

// ── DELETE /simulation/test-cases/:id ─────────────────────────────────────────

router.delete("/simulation/test-cases/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const id = Number(req.params["id"]);

  const [tc] = await db
    .select()
    .from(simulationTestCasesTable)
    .where(and(eq(simulationTestCasesTable.id, id), eq(simulationTestCasesTable.userId, userId)));

  if (!tc) {
    res.status(404).json({ error: "Test case not found" });
    return;
  }

  await db.delete(simulationTestCasesTable).where(eq(simulationTestCasesTable.id, id));
  res.status(204).end();
});

// ── POST /simulation/runs ──────────────────────────────────────────────────────
// Start a scenario simulation run

router.post("/simulation/runs", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const { test_case_id, max_turns } = req.body as {
    test_case_id?: number;
    max_turns?: number;
  };

  if (!test_case_id) {
    res.status(400).json({ error: "test_case_id is required" });
    return;
  }

  const [tc] = await db
    .select()
    .from(simulationTestCasesTable)
    .where(and(eq(simulationTestCasesTable.id, test_case_id), eq(simulationTestCasesTable.userId, userId)));

  if (!tc) {
    res.status(404).json({ error: "Test case not found" });
    return;
  }

  const [run] = await db
    .insert(simulationRunsTable)
    .values({
      agentId: tc.agentId,
      testCaseId: tc.id,
      userId,
      status: "pending",
    })
    .returning();

  const effectiveMaxTurns = max_turns ?? tc.maxTurns ?? 20;

  setImmediate(() => {
    runScenario(run!.id, test_case_id, userId, effectiveMaxTurns, (event) => {
      logger.debug({ runId: run!.id, event }, "scenario event");
    }).catch((err) => {
      logger.error({ runId: run!.id, err }, "scenario run failed");
    });
  });

  res.status(201).json(run);
});

// ── POST /simulation/runs/stream ───────────────────────────────────────────────
// SSE — start a scenario simulation and stream progress events

router.post("/simulation/runs/stream", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const { test_case_id, max_turns } = req.body as {
    test_case_id?: number;
    max_turns?: number;
  };

  if (!test_case_id) {
    res.status(400).json({ error: "test_case_id is required" });
    return;
  }

  const [tc] = await db
    .select()
    .from(simulationTestCasesTable)
    .where(and(eq(simulationTestCasesTable.id, test_case_id), eq(simulationTestCasesTable.userId, userId)));

  if (!tc) {
    res.status(404).json({ error: "Test case not found" });
    return;
  }

  const [run] = await db
    .insert(simulationRunsTable)
    .values({
      agentId: tc.agentId,
      testCaseId: tc.id,
      userId,
      status: "pending",
    })
    .returning();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  function send(event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  send("run_created", { run_id: run!.id });

  const effectiveMaxTurns = max_turns ?? tc.maxTurns ?? 20;

  await runScenario(run!.id, test_case_id, userId, effectiveMaxTurns, (event) => {
    send(event.type, event);
  });

  res.end();
});

// ── GET /simulation/runs/:id ───────────────────────────────────────────────────

router.get("/simulation/runs/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const id = Number(req.params["id"]);

  const [run] = await db
    .select()
    .from(simulationRunsTable)
    .where(and(eq(simulationRunsTable.id, id), eq(simulationRunsTable.userId, userId)));

  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  const messages = await db
    .select()
    .from(simulationMessagesTable)
    .where(eq(simulationMessagesTable.simulationRunId, id))
    .orderBy(simulationMessagesTable.createdAt);

  res.json({ ...run, messages });
});

// ── GET /simulation/runs?agent_id= ────────────────────────────────────────────

router.get("/simulation/runs", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const agentId = Number(req.query["agent_id"]);

  if (!agentId) {
    res.status(400).json({ error: "agent_id query param required" });
    return;
  }

  const runs = await db
    .select()
    .from(simulationRunsTable)
    .where(and(eq(simulationRunsTable.agentId, agentId), eq(simulationRunsTable.userId, userId)))
    .orderBy(desc(simulationRunsTable.createdAt))
    .limit(50);

  res.json(runs);
});

// ── GET /simulation/runs/:id/report ───────────────────────────────────────────

router.get("/simulation/runs/:id/report", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const id = Number(req.params["id"]);

  const [run] = await db
    .select()
    .from(simulationRunsTable)
    .where(and(eq(simulationRunsTable.id, id), eq(simulationRunsTable.userId, userId)));

  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  const messages = await db
    .select()
    .from(simulationMessagesTable)
    .where(eq(simulationMessagesTable.simulationRunId, id))
    .orderBy(simulationMessagesTable.createdAt);

  const report = {
    run,
    messages,
    exportedAt: new Date().toISOString(),
  };

  res.setHeader("Content-Disposition", `attachment; filename="simulation-run-${id}.json"`);
  res.json(report);
});

// ── GET /simulation/templates ─────────────────────────────────────────────────

router.get("/simulation/templates", (_req: Request, res: Response): void => {
  res.json(HEALTH_INSURANCE_TEMPLATES);
});

export default router;

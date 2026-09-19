import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, agentsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext } from "../middlewares/clientContext.js";
import { resolveWorkspaceScope } from "../services/workspace-scope.js";
import {
  applyGymLesson,
  getGymRun,
  learnFromCampaignCalls,
  listGymState,
  runGymPersona,
} from "../services/agent-gym.js";
import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

async function loadOwnedAgent(clerkId: string, agentId: number) {
  const scope = await resolveWorkspaceScope(clerkId);
  const [agent] = await db
    .select({ id: agentsTable.id, userId: agentsTable.userId })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), inArray(agentsTable.userId, scope.userIds)))
    .limit(1);
  return { scope, agent };
}

router.get("/agents/:id/gym", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as { clerkUserId: string }).clerkUserId;
  const agentId = parseInt(String(req.params["id"] ?? ""), 10);
  if (!Number.isFinite(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }
  const { scope, agent } = await loadOwnedAgent(clerkId, agentId);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  const state = await listGymState(agentId, agent.userId ?? clerkId);
  res.json({ personas: state.personas, runs: state.runs, canWrite: scope.canWrite });
});

router.get("/agents/:id/gym/runs/:runId", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as { clerkUserId: string }).clerkUserId;
  const agentId = parseInt(String(req.params["id"] ?? ""), 10);
  const runId = parseInt(String(req.params["runId"] ?? ""), 10);
  if (!Number.isFinite(agentId) || !Number.isFinite(runId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { agent } = await loadOwnedAgent(clerkId, agentId);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  const detail = await getGymRun(agentId, runId);
  if (!detail) { res.status(404).json({ error: "Gym run not found" }); return; }
  res.json(detail);
});

router.post("/agents/:id/gym/run", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as { clerkUserId: string }).clerkUserId;
  const agentId = parseInt(String(req.params["id"] ?? ""), 10);
  if (!Number.isFinite(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }
  const { scope, agent } = await loadOwnedAgent(clerkId, agentId);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  if (!scope.canWrite) { res.status(403).json({ error: "Your team role cannot run gym tests" }); return; }
  const personaId = typeof req.body?.personaId === "string" ? req.body.personaId.trim() : "";
  if (!personaId) { res.status(400).json({ error: "personaId is required" }); return; }
  const suiteId = typeof req.body?.suiteId === "string" && req.body.suiteId.trim()
    ? req.body.suiteId.trim()
    : randomUUID();
  try {
    const run = await runGymPersona({
      agentId,
      userId: agent.userId ?? clerkId,
      personaId,
      suiteId,
    });
    res.json({ run, suiteId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gym run failed";
    logger.warn({ err, agentId, personaId }, "Gym run failed");
    const status = message.includes("Unknown gym persona") ? 400
      : message.includes("key configured") ? 422
      : 500;
    res.status(status).json({ error: message });
  }
});

router.post("/agents/:id/gym/learn", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as { clerkUserId: string }).clerkUserId;
  const agentId = parseInt(String(req.params["id"] ?? ""), 10);
  if (!Number.isFinite(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }
  const { scope, agent } = await loadOwnedAgent(clerkId, agentId);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  if (!scope.canWrite) { res.status(403).json({ error: "Your team role cannot run gym tests" }); return; }
  try {
    const result = await learnFromCampaignCalls({ agentId, userId: agent.userId ?? clerkId });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Campaign learn failed";
    logger.warn({ err, agentId }, "Gym campaign learn failed");
    const status = message.includes("key configured") ? 422 : 500;
    res.status(status).json({ error: message });
  }
});

router.post("/agents/:id/gym/apply", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as { clerkUserId: string }).clerkUserId;
  const agentId = parseInt(String(req.params["id"] ?? ""), 10);
  if (!Number.isFinite(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }
  const { scope, agent } = await loadOwnedAgent(clerkId, agentId);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  if (!scope.canWrite) { res.status(403).json({ error: "Your team role cannot edit agents" }); return; }
  const runId = Number(req.body?.runId);
  if (!Number.isFinite(runId)) { res.status(400).json({ error: "runId is required" }); return; }
  try {
    const result = await applyGymLesson({ agentId, runId });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Apply failed";
    const status = message.includes("not found") ? 404 : message.includes("no prompt suggestion") ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

export default router;

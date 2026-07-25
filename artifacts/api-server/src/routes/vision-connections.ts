import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, agentsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
import {
  listConnections,
  createConnection,
  updateConnection,
  deleteConnection,
  testConnection,
} from "../services/vision-connections.js";

const router = Router();

// ── Helper: verify agent belongs to user ─────────────────────────────────────
async function getAgentForUser(agentId: number, clerkId: string) {
  const [agent] = await db
    .select({ id: agentsTable.id, userId: agentsTable.userId })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkId)))
    .limit(1);
  return agent ?? null;
}

// ── List connections ──────────────────────────────────────────────────────────
router.get("/vision-agents/:id/connections", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.id), 10);
  const clerkId = (req as any).clerkUserId as string;

  if (!Number.isFinite(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }
  const agent = await getAgentForUser(agentId, clerkId);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  try {
    const connections = await listConnections(agentId);
    res.json(connections);
  } catch (err) {
    logger.error({ err, agentId }, "Failed to list vision connections");
    res.status(500).json({ error: "Failed to list connections" });
  }
});

// ── Create connection ─────────────────────────────────────────────────────────
router.post("/vision-agents/:id/connections", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.id), 10);
  const clerkId = (req as any).clerkUserId as string;

  if (!Number.isFinite(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }
  const agent = await getAgentForUser(agentId, clerkId);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!body["name"] || typeof body["name"] !== "string") {
    res.status(400).json({ error: "name is required" }); return;
  }
  if (!body["type"] || typeof body["type"] !== "string") {
    res.status(400).json({ error: "type is required (rest_api | webhook | database)" }); return;
  }

  try {
    const connection = await createConnection(agentId, clerkId, {
      name: body["name"],
      description: typeof body["description"] === "string" ? body["description"] : null,
      type: body["type"],
      active: body["active"] !== false,
      config: (body["config"] as Record<string, unknown> | undefined) ?? {},
    });
    res.status(201).json(connection);
  } catch (err) {
    logger.error({ err, agentId }, "Failed to create vision connection");
    res.status(500).json({ error: "Failed to create connection" });
  }
});

// ── Update connection ─────────────────────────────────────────────────────────
router.patch("/vision-agents/:id/connections/:connId", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.id), 10);
  const connId = parseInt(String(req.params.connId), 10);
  const clerkId = (req as any).clerkUserId as string;

  if (!Number.isFinite(agentId) || !Number.isFinite(connId)) {
    res.status(400).json({ error: "Invalid id" }); return;
  }
  const agent = await getAgentForUser(agentId, clerkId);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Parameters<typeof updateConnection>[1] = {};
  if (typeof body["name"] === "string") patch.name = body["name"];
  if (typeof body["description"] === "string") patch.description = body["description"];
  if (typeof body["type"] === "string") patch.type = body["type"];
  if (typeof body["active"] === "boolean") patch.active = body["active"];
  if (body["config"] != null) patch.config = body["config"] as Record<string, unknown>;

  try {
    const connection = await updateConnection(connId, patch);
    res.json(connection);
  } catch (err) {
    logger.error({ err, connId }, "Failed to update vision connection");
    res.status(500).json({ error: "Failed to update connection" });
  }
});

// ── Delete connection ─────────────────────────────────────────────────────────
router.delete("/vision-agents/:id/connections/:connId", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.id), 10);
  const connId = parseInt(String(req.params.connId), 10);
  const clerkId = (req as any).clerkUserId as string;

  if (!Number.isFinite(agentId) || !Number.isFinite(connId)) {
    res.status(400).json({ error: "Invalid id" }); return;
  }
  const agent = await getAgentForUser(agentId, clerkId);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  try {
    await deleteConnection(connId);
    res.status(204).end();
  } catch (err) {
    logger.error({ err, connId }, "Failed to delete vision connection");
    res.status(500).json({ error: "Failed to delete connection" });
  }
});

// ── Test connection ───────────────────────────────────────────────────────────
router.post("/vision-agents/:id/connections/:connId/test", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.id), 10);
  const connId = parseInt(String(req.params.connId), 10);
  const clerkId = (req as any).clerkUserId as string;

  if (!Number.isFinite(agentId) || !Number.isFinite(connId)) {
    res.status(400).json({ error: "Invalid id" }); return;
  }
  const agent = await getAgentForUser(agentId, clerkId);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  try {
    const result = await testConnection(connId);
    res.json(result);
  } catch (err) {
    logger.error({ err, connId }, "Failed to test vision connection");
    res.status(500).json({ ok: false, latencyMs: 0, error: "Internal error during connection test" });
  }
});

export default router;

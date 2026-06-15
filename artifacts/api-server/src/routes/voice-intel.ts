/**
 * Voice Intelligence routes — voice prints per agent.
 *
 * GET  /agents/:id/voice-prints        — list all enrolled voice prints for an agent
 * DELETE /agents/:id/voice-prints/:printId — delete a voice print (and its Azure profile)
 */

import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, agentsTable, voicePrintsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── GET /agents/:id/voice-prints ─────────────────────────────────────────────

router.get("/agents/:id/voice-prints", requireAuth, async (req, res): Promise<void> => {
  const clerkId  = (req as any).clerkUserId as string;
  const agentId  = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }

  // Verify agent belongs to auth user
  const [agent] = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkId)));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  const prints = await db
    .select()
    .from(voicePrintsTable)
    .where(eq(voicePrintsTable.agentId, agentId))
    .orderBy(voicePrintsTable.createdAt);

  res.json(prints);
});

// ── DELETE /agents/:id/voice-prints/:printId ──────────────────────────────────

router.delete("/agents/:id/voice-prints/:printId", requireAuth, async (req, res): Promise<void> => {
  const clerkId  = (req as any).clerkUserId as string;
  const agentId  = parseInt(String(req.params["id"] ?? ""), 10);
  const printId  = parseInt(String(req.params["printId"] ?? ""), 10);
  if (isNaN(agentId) || isNaN(printId)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Verify agent belongs to auth user
  const [agent] = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkId)));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  const [print] = await db
    .select()
    .from(voicePrintsTable)
    .where(and(eq(voicePrintsTable.id, printId), eq(voicePrintsTable.agentId, agentId)));
  if (!print) { res.status(404).json({ error: "Voice print not found" }); return; }

  await db
    .delete(voicePrintsTable)
    .where(eq(voicePrintsTable.id, printId));

  logger.info({ agentId, printId, phoneNumber: print.phoneNumber }, "Voice print deleted");
  res.status(204).end();
});

export default router;

import { Router } from "express";
import { db, agentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAuth } from "../lib/auth-compat.js";
import { issueTicket } from "../lib/webcall-ticket.js";
import { z } from "zod/v4";
import { logger } from "../lib/logger.js";

const router = Router();

const BodySchema = z.object({ agentId: z.number().int().positive() });

/**
 * POST /webcall/ticket
 *
 * Issues a short-lived (60 s), single-use ticket the frontend exchanges for
 * a webcall WebSocket connection.  Keeps the session JWT out of the WS URL
 * (and therefore out of server access logs).
 *
 * Auth: Bearer session JWT required.
 * Ownership: the requesting user must own the target agent.
 */
router.post("/webcall/ticket", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "agentId required" });
    return;
  }

  const { agentId } = parsed.data;

  const [agent] = await db
    .select({ userId: agentsTable.userId })
    .from(agentsTable)
    .where(eq(agentsTable.id, agentId));

  if (!agent || agent.userId !== userId) {
    logger.warn({ agentId, userId }, "webcall ticket refused: agent not found or not owned");
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const ticket = issueTicket(agentId, userId);
  res.json({ ticket });
});

export default router;

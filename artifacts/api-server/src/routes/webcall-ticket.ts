import { Router } from "express";
import { db, agentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAuth } from "../lib/auth-compat.js";
import { issueTicket } from "../lib/webcall-ticket.js";
import { z } from "zod/v4";
import { logger } from "../lib/logger.js";
import { evaluateIrdaiGate, IRDAI_BLOCKED_MESSAGE, IRDAI_BLOCKED_CODE } from "../services/irdai/gate.js";

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
    .select({ userId: agentsTable.userId, agentConfig: agentsTable.agentConfig })
    .from(agentsTable)
    .where(eq(agentsTable.id, agentId));

  if (!agent || agent.userId !== userId) {
    logger.warn({ agentId, userId }, "webcall ticket refused: agent not found or not owned");
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // IRDAI compliance enforcement gate. Reads the agent's latest stored
  // irdaiComplianceStatus (no re-check at call time). Blocks the web call when
  // IRDAI is enabled AND any required disclosure is still missing.
  const irdaiGate = evaluateIrdaiGate(agent.agentConfig);
  if (irdaiGate.blocked) {
    logger.info({ agentId, missing: irdaiGate.missingItems.map((m) => m.requirement) }, "web call blocked by IRDAI compliance");
    res.status(403).json({
      error: IRDAI_BLOCKED_MESSAGE,
      code: IRDAI_BLOCKED_CODE,
      missingItems: irdaiGate.missingItems,
    });
    return;
  }

  const ticket = issueTicket(agentId, userId);
  res.json({ ticket });
});

export default router;

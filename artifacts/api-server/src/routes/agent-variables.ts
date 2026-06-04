/**
 * Agent Variable Registry routes — Phase 1A
 * ─────────────────────────────────────────────────────────────────────────────
 * CRUD for agent_variables.
 * Used by the batch wizard for CSV column mapping and pre-call variable injection.
 */

import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq, and } from "drizzle-orm";
import { db, agentsTable, agentVariablesTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

async function requireAgent(agentId: number, userId: string) {
  const [row] = await db.select({ id: agentsTable.id })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, userId)));
  return row ?? null;
}

// GET /agents/:id/variables
router.get("/agents/:id/variables", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const agentId = parseInt(req.params["id"]!, 10);
  if (!await requireAgent(agentId, userId)) { res.status(404).json({ error: "Agent not found" }); return; }

  const variables = await db.select().from(agentVariablesTable)
    .where(eq(agentVariablesTable.agentId, agentId))
    .orderBy(agentVariablesTable.variableName);
  res.json(variables);
});

// POST /agents/:id/variables
router.post("/agents/:id/variables", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const agentId = parseInt(req.params["id"]!, 10);
  if (!await requireAgent(agentId, userId)) { res.status(404).json({ error: "Agent not found" }); return; }

  const { variableName, displayLabel, isRequired, defaultValue, dataType } = req.body as {
    variableName: string;
    displayLabel: string;
    isRequired?: boolean;
    defaultValue?: string;
    dataType: string;
  };

  if (!variableName?.trim() || !displayLabel?.trim() || !dataType) {
    res.status(400).json({ error: "variableName, displayLabel, and dataType are required" });
    return;
  }

  // Enforce snake_case variable name (lowercase, underscores only)
  const normalizedName = variableName.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");

  try {
    const [variable] = await db.insert(agentVariablesTable).values({
      agentId,
      variableName: normalizedName,
      displayLabel: displayLabel.trim(),
      isRequired: isRequired ?? false,
      defaultValue: defaultValue ?? null,
      dataType,
    }).returning();
    res.status(201).json(variable);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("unique")) {
      res.status(409).json({ error: `Variable '${normalizedName}' already exists for this agent` });
    } else {
      logger.error({ err, agentId }, "Failed to create agent variable");
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// PATCH /agents/:id/variables/:varId
router.patch("/agents/:id/variables/:varId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const agentId = parseInt(req.params["id"]!, 10);
  const varId   = parseInt(req.params["varId"]!, 10);
  if (!await requireAgent(agentId, userId)) { res.status(404).json({ error: "Agent not found" }); return; }

  const { displayLabel, isRequired, defaultValue, dataType } = req.body as {
    displayLabel?: string;
    isRequired?: boolean;
    defaultValue?: string | null;
    dataType?: string;
  };

  const updates: Partial<typeof agentVariablesTable.$inferInsert> = {};
  if (displayLabel !== undefined) updates.displayLabel = displayLabel.trim();
  if (isRequired   !== undefined) updates.isRequired   = isRequired;
  if (defaultValue !== undefined) updates.defaultValue = defaultValue;
  if (dataType     !== undefined) updates.dataType     = dataType;

  const [updated] = await db.update(agentVariablesTable)
    .set(updates)
    .where(and(eq(agentVariablesTable.id, varId), eq(agentVariablesTable.agentId, agentId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Variable not found" }); return; }
  res.json(updated);
});

// DELETE /agents/:id/variables/:varId
router.delete("/agents/:id/variables/:varId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const agentId = parseInt(req.params["id"]!, 10);
  const varId   = parseInt(req.params["varId"]!, 10);
  if (!await requireAgent(agentId, userId)) { res.status(404).json({ error: "Agent not found" }); return; }

  const [deleted] = await db.delete(agentVariablesTable)
    .where(and(eq(agentVariablesTable.id, varId), eq(agentVariablesTable.agentId, agentId)))
    .returning({ id: agentVariablesTable.id });
  if (!deleted) { res.status(404).json({ error: "Variable not found" }); return; }
  res.status(204).end();
});

export default router;

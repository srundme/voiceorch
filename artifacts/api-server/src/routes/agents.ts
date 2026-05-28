import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, agentsTable, schedulingCalendarsTable } from "@workspace/db";
import {
  CreateAgentBody,
  UpdateAgentBody,
  GetAgentParams,
  UpdateAgentParams,
  DeleteAgentParams,
  ToggleAgentParams,
  ListAgentsResponse,
  GetAgentResponse,
  UpdateAgentResponse,
  ToggleAgentResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logActivity } from "../lib/activity.js";
import { encryptKey, decryptKey } from "../lib/crypto.js";

const router: IRouter = Router();

function maskLeadToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const plain = decryptKey(token);
  if (plain.length <= 4) return "****";
  return "..." + plain.slice(-4);
}

function prepareAgentForResponse(agent: typeof agentsTable.$inferSelect) {
  return {
    ...agent,
    leadSourceToken: maskLeadToken(agent.leadSourceToken),
  };
}

router.get("/agents", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const agents = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.userId, clerkId))
    .orderBy(agentsTable.createdAt);
  res.json(ListAgentsResponse.parse(agents.map(prepareAgentForResponse)));
});

router.post("/agents", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = CreateAgentBody.safeParse(req.body);
  if (!parsed.success) {
    const issues = parsed.error.issues;
    req.log.warn({ issues, body: req.body }, "Create agent validation failed");
    res.status(400).json({ error: "Validation failed", issues });
    return;
  }
  const insertData = { ...parsed.data, userId: clerkId };
  if (insertData.leadSourceToken) {
    insertData.leadSourceToken = encryptKey(insertData.leadSourceToken);
  }
  const [agent] = await db
    .insert(agentsTable)
    .values(insertData)
    .returning();
  await logActivity({ userId: clerkId, eventType: "agent.created", resourceType: "agent", resourceId: String(agent.id), description: `Agent "${agent.name}" created` });
  db.insert(schedulingCalendarsTable)
    .values({
      agentId: agent.id,
      userId: clerkId,
      name: `${agent.name} Calendar`,
      timezone: "UTC",
      isActive: true,
    })
    .onConflictDoNothing()
    .catch((err) => {
      req.log.warn({ err, agentId: agent.id }, "Failed to auto-create scheduling calendar for agent");
    });
  res.status(201).json(GetAgentResponse.parse(prepareAgentForResponse(agent)));
});

router.get("/agents/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = GetAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Validation failed", issues: params.error.issues });
    return;
  }
  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.userId, clerkId)));
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json(GetAgentResponse.parse(prepareAgentForResponse(agent)));
});

router.patch("/agents/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = UpdateAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Validation failed", issues: params.error.issues });
    return;
  }
  const parsed = UpdateAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }
  const updateData: Record<string, unknown> = { ...parsed.data };
  if (updateData.leadSourceToken) {
    updateData.leadSourceToken = encryptKey(updateData.leadSourceToken as string);
  }
  const [agent] = await db
    .update(agentsTable)
    .set({ ...updateData, updatedAt: new Date() })
    .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.userId, clerkId)))
    .returning();
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json(UpdateAgentResponse.parse(prepareAgentForResponse(agent)));
});

router.delete("/agents/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = DeleteAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Validation failed", issues: params.error.issues });
    return;
  }
  const [deleted] = await db
    .delete(agentsTable)
    .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.userId, clerkId)))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  await logActivity({ userId: clerkId, eventType: "agent.deleted", resourceType: "agent", resourceId: String(deleted.id), description: `Agent "${deleted.name}" deleted` });
  res.sendStatus(204);
});

router.patch("/agents/:id/toggle", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = ToggleAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Validation failed", issues: params.error.issues });
    return;
  }
  const [existing] = await db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.userId, clerkId)));
  if (!existing) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  const newStatus = existing.status === "active" ? "inactive" : "active";
  const [agent] = await db
    .update(agentsTable)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.userId, clerkId)))
    .returning();
  await logActivity({ userId: clerkId, eventType: "agent.toggled", resourceType: "agent", resourceId: String(agent.id), description: `Agent "${agent.name}" set to ${newStatus}` });
  res.json(ToggleAgentResponse.parse(agent));
});

export default router;

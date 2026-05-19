import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, agentsTable } from "@workspace/db";
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

const router: IRouter = Router();

router.get("/agents", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const agents = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.userId, clerkId))
    .orderBy(agentsTable.createdAt);
  res.json(ListAgentsResponse.parse(agents));
});

router.post("/agents", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = CreateAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [agent] = await db
    .insert(agentsTable)
    .values({ ...parsed.data, userId: clerkId })
    .returning();
  res.status(201).json(GetAgentResponse.parse(agent));
});

router.get("/agents/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = GetAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
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
  res.json(GetAgentResponse.parse(agent));
});

router.patch("/agents/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = UpdateAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [agent] = await db
    .update(agentsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.userId, clerkId)))
    .returning();
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json(UpdateAgentResponse.parse(agent));
});

router.delete("/agents/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = DeleteAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
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
  res.sendStatus(204);
});

router.patch("/agents/:id/toggle", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = ToggleAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
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
  res.json(ToggleAgentResponse.parse(agent));
});

export default router;

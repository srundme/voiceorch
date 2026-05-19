import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, callsTable, agentsTable } from "@workspace/db";
import {
  InitiateCallBody,
  UpdateCallBody,
  GetCallParams,
  UpdateCallParams,
  EndCallParams,
  ListCallsQueryParams,
  ListCallsResponse,
  GetCallResponse,
  UpdateCallResponse,
  EndCallResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function enrichCall(call: typeof callsTable.$inferSelect) {
  const [agent] = await db.select({ name: agentsTable.name }).from(agentsTable).where(eq(agentsTable.id, call.agentId));
  return {
    ...call,
    agentName: agent?.name ?? "Unknown Agent",
    endedAt: call.endedAt?.toISOString() ?? null,
    createdAt: call.createdAt.toISOString(),
  };
}

router.get("/calls", async (req, res): Promise<void> => {
  const query = ListCallsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  let dbQuery = db.select().from(callsTable).$dynamic();

  if (query.data.agentId != null) {
    dbQuery = dbQuery.where(eq(callsTable.agentId, query.data.agentId)) as typeof dbQuery;
  }

  const calls = await dbQuery.orderBy(desc(callsTable.createdAt));
  const enriched = await Promise.all(calls.map(enrichCall));
  res.json(ListCallsResponse.parse(enriched));
});

router.post("/calls", async (req, res): Promise<void> => {
  const parsed = InitiateCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, parsed.data.agentId));
  if (!agent) {
    res.status(400).json({ error: "Agent not found" });
    return;
  }

  const [call] = await db
    .insert(callsTable)
    .values({ ...parsed.data, status: "pending" })
    .returning();

  await db
    .update(agentsTable)
    .set({ totalCalls: agent.totalCalls + 1 })
    .where(eq(agentsTable.id, agent.id));

  const enriched = await enrichCall(call);
  res.status(201).json(GetCallResponse.parse(enriched));
});

router.get("/calls/:id", async (req, res): Promise<void> => {
  const params = GetCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, params.data.id));
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  const enriched = await enrichCall(call);
  res.json(GetCallResponse.parse(enriched));
});

router.patch("/calls/:id", async (req, res): Promise<void> => {
  const params = UpdateCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.endedAt) {
    updateData.endedAt = new Date(parsed.data.endedAt);
  }

  const [call] = await db
    .update(callsTable)
    .set(updateData)
    .where(eq(callsTable.id, params.data.id))
    .returning();

  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  const enriched = await enrichCall(call);
  res.json(UpdateCallResponse.parse(enriched));
});

router.patch("/calls/:id/end", async (req, res): Promise<void> => {
  const params = EndCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db.select().from(callsTable).where(eq(callsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  const endedAt = new Date();
  const durationSeconds = Math.floor((endedAt.getTime() - existing.createdAt.getTime()) / 1000);

  const [call] = await db
    .update(callsTable)
    .set({ status: "completed", endedAt, durationSeconds })
    .where(eq(callsTable.id, params.data.id))
    .returning();

  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, call.agentId));
  if (agent) {
    const newSuccessful = agent.successfulCalls + 1;
    const newAvg = agent.avgDurationSeconds
      ? Math.floor((agent.avgDurationSeconds * agent.successfulCalls + durationSeconds) / newSuccessful)
      : durationSeconds;
    await db
      .update(agentsTable)
      .set({ successfulCalls: newSuccessful, avgDurationSeconds: newAvg })
      .where(eq(agentsTable.id, agent.id));
  }

  const enriched = await enrichCall(call);
  res.json(EndCallResponse.parse(enriched));
});

export default router;

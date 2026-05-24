import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, schedulingCalendarsTable, agentsTable } from "@workspace/db";
import { requireAuth } from "../../middlewares/requireAuth.js";
import {
  CreateCalendarBody,
  UpdateCalendarBody,
  GetCalendarParams,
  UpdateCalendarParams,
  DeleteCalendarParams,
  ListCalendarsResponse,
  GetCalendarResponse,
  UpdateCalendarResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/scheduling/calendars", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const rows = await db.select().from(schedulingCalendarsTable)
    .where(eq(schedulingCalendarsTable.userId, clerkId))
    .orderBy(schedulingCalendarsTable.createdAt);
  res.json(ListCalendarsResponse.parse(rows));
});

router.post("/scheduling/calendars", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = CreateCalendarBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  // Verify the referenced agent belongs to the caller
  const [agent] = await db.select({ id: agentsTable.id }).from(agentsTable)
    .where(and(eq(agentsTable.id, parsed.data.agentId), eq(agentsTable.userId, clerkId)));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  const [row] = await db.insert(schedulingCalendarsTable)
    .values({ ...parsed.data, userId: clerkId })
    .returning();
  res.status(201).json(GetCalendarResponse.parse(row));
});

router.get("/scheduling/calendars/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = GetCalendarParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.select().from(schedulingCalendarsTable)
    .where(and(eq(schedulingCalendarsTable.id, params.data.id), eq(schedulingCalendarsTable.userId, clerkId)));
  if (!row) { res.status(404).json({ error: "Calendar not found" }); return; }
  res.json(GetCalendarResponse.parse(row));
});

router.patch("/scheduling/calendars/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = UpdateCalendarParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateCalendarBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.update(schedulingCalendarsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(schedulingCalendarsTable.id, params.data.id), eq(schedulingCalendarsTable.userId, clerkId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Calendar not found" }); return; }
  res.json(UpdateCalendarResponse.parse(row));
});

router.delete("/scheduling/calendars/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = DeleteCalendarParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.delete(schedulingCalendarsTable)
    .where(and(eq(schedulingCalendarsTable.id, params.data.id), eq(schedulingCalendarsTable.userId, clerkId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Calendar not found" }); return; }
  res.sendStatus(204);
});

export default router;

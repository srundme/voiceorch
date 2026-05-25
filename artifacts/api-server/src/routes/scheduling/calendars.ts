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

// ── Link / unlink a Google Calendar connection to a scheduling calendar ──────

router.patch("/scheduling/calendars/:id/google-connection", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const { id } = req.params as { id: string };
  const { connectionId } = req.body as { connectionId: string | null };

  // Verify calendar ownership (id column is serial/integer)
  const numericId = parseInt(id, 10);
  if (isNaN(numericId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [cal] = await db.select({ id: schedulingCalendarsTable.id })
    .from(schedulingCalendarsTable)
    .where(and(eq(schedulingCalendarsTable.id, numericId), eq(schedulingCalendarsTable.userId, clerkId)));
  if (!cal) { res.status(404).json({ error: "Calendar not found" }); return; }

  // If linking, verify the connection belongs to this user
  if (connectionId) {
    const { sql } = await import("drizzle-orm");
    const rows = await db.execute(
      sql`SELECT id FROM google_calendar_connections WHERE id = ${connectionId} AND user_id = ${clerkId}`
    );
    if (!rows.rows[0]) { res.status(403).json({ error: "Google connection not found or not yours" }); return; }
  }

  const { sql } = await import("drizzle-orm");
  await db.execute(
    sql`UPDATE scheduling_calendars SET google_calendar_connection_id = ${connectionId ?? null}, updated_at = NOW() WHERE id = ${id}`
  );
  res.sendStatus(204);
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

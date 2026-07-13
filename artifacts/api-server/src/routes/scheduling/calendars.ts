import { Router, type IRouter } from "express";
import { eq, and, count, sql } from "drizzle-orm";
import { db, schedulingCalendarsTable, googleCalendarConnectionsTable, bookingsTable, agentsTable } from "@workspace/db";
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

async function getGoogleAccountsCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(googleCalendarConnectionsTable)
    .where(eq(googleCalendarConnectionsTable.userId, userId));
  return row?.total ?? 0;
}

async function enrichCalendarRow(row: typeof schedulingCalendarsTable.$inferSelect, googleAccountsCount: number) {
  let connectedGoogleEmail: string | null = null;
  if (row.googleCalendarConnectionId) {
    const [conn] = await db
      .select({ email: googleCalendarConnectionsTable.email })
      .from(googleCalendarConnectionsTable)
      .where(eq(googleCalendarConnectionsTable.id, row.googleCalendarConnectionId));
    connectedGoogleEmail = conn?.email ?? null;
  }
  return { ...row, connectedGoogleEmail, connectedGoogleAccountsCount: googleAccountsCount };
}

router.get("/scheduling/calendars", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;

  const rows = await db.select().from(schedulingCalendarsTable)
    .where(eq(schedulingCalendarsTable.userId, clerkId))
    .orderBy(schedulingCalendarsTable.createdAt);

  const googleAccountsCount = await getGoogleAccountsCount(clerkId);

  // Batch-fetch all linked connection emails in one query
  const connectionIds = rows
    .map(r => r.googleCalendarConnectionId)
    .filter((id): id is string => id != null);

  const emailMap: Record<string, string> = {};
  if (connectionIds.length > 0) {
    const { inArray } = await import("drizzle-orm");
    const conns = await db
      .select({ id: googleCalendarConnectionsTable.id, email: googleCalendarConnectionsTable.email })
      .from(googleCalendarConnectionsTable)
      .where(inArray(googleCalendarConnectionsTable.id, connectionIds));
    for (const c of conns) emailMap[c.id] = c.email;
  }

  // Build calendarId → agentName map via JSONB lookup (no schema column needed).
  const calendarIds = rows.map(r => r.id);
  const agentNameMap: Record<number, string> = {};
  if (calendarIds.length > 0) {
    const agentRows = await db
      .select({
        name: agentsTable.name,
        calendarId: sql<number>`(${agentsTable.agentConfig}->'calendarCapability'->>'defaultCalendarId')::integer`,
      })
      .from(agentsTable)
      .where(
        sql`${agentsTable.userId} = ${clerkId}
          AND (${agentsTable.agentConfig}->'calendarCapability'->>'defaultCalendarId') IS NOT NULL`
      );
    for (const a of agentRows) {
      if (a.calendarId != null) agentNameMap[a.calendarId] = a.name;
    }
  }

  const enriched = rows.map(r => ({
    ...r,
    connectedGoogleEmail: r.googleCalendarConnectionId ? (emailMap[r.googleCalendarConnectionId] ?? null) : null,
    connectedGoogleAccountsCount: googleAccountsCount,
    connectedAgentName: agentNameMap[r.id] ?? null,
  }));

  res.json(ListCalendarsResponse.parse(enriched));
});

router.post("/scheduling/calendars", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = CreateCalendarBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  const [row] = await db.insert(schedulingCalendarsTable)
    .values({ ...parsed.data, userId: clerkId })
    .returning();
  res.status(201).json(GetCalendarResponse.parse({ ...row, connectedGoogleEmail: null, connectedGoogleAccountsCount: 0 }));
});

router.get("/scheduling/calendars/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = GetCalendarParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Validation failed", issues: params.error.issues }); return; }
  const [row] = await db.select().from(schedulingCalendarsTable)
    .where(and(eq(schedulingCalendarsTable.id, params.data.id), eq(schedulingCalendarsTable.userId, clerkId)));
  if (!row) { res.status(404).json({ error: "Calendar not found" }); return; }
  const googleAccountsCount = await getGoogleAccountsCount(clerkId);
  const enriched = await enrichCalendarRow(row, googleAccountsCount);
  res.json(GetCalendarResponse.parse(enriched));
});

router.patch("/scheduling/calendars/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = UpdateCalendarParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Validation failed", issues: params.error.issues }); return; }
  const parsed = UpdateCalendarBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  const [row] = await db.update(schedulingCalendarsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(schedulingCalendarsTable.id, params.data.id), eq(schedulingCalendarsTable.userId, clerkId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Calendar not found" }); return; }
  res.json(UpdateCalendarResponse.parse({ ...row, connectedGoogleEmail: null, connectedGoogleAccountsCount: null }));
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
  if (!params.success) { res.status(400).json({ error: "Validation failed", issues: params.error.issues }); return; }

  const force = req.query.force === "true";

  if (!force) {
    const [countRow] = await db
      .select({ total: count() })
      .from(bookingsTable)
      .where(eq(bookingsTable.calendarId, params.data.id));
    const bookingCount = countRow?.total ?? 0;
    if (bookingCount > 0) {
      res.status(409).json({ error: "Calendar has bookings", bookingCount });
      return;
    }
  }

  const [row] = await db.delete(schedulingCalendarsTable)
    .where(and(eq(schedulingCalendarsTable.id, params.data.id), eq(schedulingCalendarsTable.userId, clerkId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Calendar not found" }); return; }
  res.sendStatus(204);
});

export default router;

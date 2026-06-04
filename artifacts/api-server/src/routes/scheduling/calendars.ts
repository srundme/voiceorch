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

const _EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Split each entry on commas/semicolons/whitespace, trim, validate, and dedupe.
 * Returns one email address per array element. Invalid addresses are dropped.
 * Handles legacy combined-string rows (e.g. ["a@x.com, b@x.com"]) transparently.
 */
function normalizeAdditionalHosts(emails: string[] | null | undefined): string[] | null {
  if (!emails || emails.length === 0) return emails ?? null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of emails) {
    for (const e of entry.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)) {
      if (!_EMAIL_RE.test(e)) continue;
      const key = e.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
  }
  return out.length > 0 ? out : null;
}

/**
 * Normalize a hostEmail field: trim whitespace, then extract the first valid
 * email address from the value. This handles legacy combined strings like
 * "a@x.com, b@x.com" by keeping only the first valid address (extras are lost,
 * but the runtime splitter in google-calendar.ts rescues them for event creation).
 * Returns null when no valid address is found.
 */
function normalizeHostEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const candidates = email.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  for (const c of candidates) {
    if (_EMAIL_RE.test(c)) return c;
  }
  return null;
}

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
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  // Verify the referenced agent belongs to the caller
  const [agent] = await db.select({ id: agentsTable.id }).from(agentsTable)
    .where(and(eq(agentsTable.id, parsed.data.agentId), eq(agentsTable.userId, clerkId)));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  const [row] = await db.insert(schedulingCalendarsTable)
    .values({
      ...parsed.data,
      hostEmail: normalizeHostEmail(parsed.data.hostEmail),
      additionalHosts: normalizeAdditionalHosts(parsed.data.additionalHosts),
      userId: clerkId,
    })
    .returning();
  res.status(201).json(GetCalendarResponse.parse(row));
});

router.get("/scheduling/calendars/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = GetCalendarParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Validation failed", issues: params.error.issues }); return; }
  const [row] = await db.select().from(schedulingCalendarsTable)
    .where(and(eq(schedulingCalendarsTable.id, params.data.id), eq(schedulingCalendarsTable.userId, clerkId)));
  if (!row) { res.status(404).json({ error: "Calendar not found" }); return; }
  res.json(GetCalendarResponse.parse(row));
});

router.patch("/scheduling/calendars/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = UpdateCalendarParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Validation failed", issues: params.error.issues }); return; }
  const parsed = UpdateCalendarBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  const updates: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  // Only normalize email fields when they were explicitly included in the request body.
  // Applying normalizeAdditionalHosts(undefined) would produce null and silently
  // wipe an existing additionalHosts value on unrelated PATCH calls.
  if ("hostEmail" in parsed.data) {
    updates["hostEmail"] = normalizeHostEmail(parsed.data.hostEmail);
  }
  if ("additionalHosts" in parsed.data) {
    updates["additionalHosts"] = normalizeAdditionalHosts(parsed.data.additionalHosts);
  }
  const [row] = await db.update(schedulingCalendarsTable)
    .set(updates as Partial<typeof schedulingCalendarsTable.$inferInsert>)
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
  if (!params.success) { res.status(400).json({ error: "Validation failed", issues: params.error.issues }); return; }
  const [row] = await db.delete(schedulingCalendarsTable)
    .where(and(eq(schedulingCalendarsTable.id, params.data.id), eq(schedulingCalendarsTable.userId, clerkId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Calendar not found" }); return; }
  res.sendStatus(204);
});

export default router;

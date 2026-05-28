import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, eventTypesTable, schedulingCalendarsTable } from "@workspace/db";
import { requireAuth } from "../../middlewares/requireAuth.js";
import {
  CreateEventTypeBody,
  UpdateEventTypeBody,
  GetEventTypeParams,
  UpdateEventTypeParams,
  DeleteEventTypeParams,
  ListEventTypesQueryParams,
  ListEventTypesResponse,
  GetEventTypeResponse,
  UpdateEventTypeResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/scheduling/event-types", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const qp = ListEventTypesQueryParams.safeParse(req.query);
  const rows = await db.select().from(eventTypesTable)
    .where(and(
      eq(eventTypesTable.userId, clerkId),
      qp.success && qp.data.calendarId != null
        ? eq(eventTypesTable.calendarId, qp.data.calendarId)
        : undefined,
    ))
    .orderBy(eventTypesTable.createdAt);
  res.json(ListEventTypesResponse.parse(rows));
});

router.post("/scheduling/event-types", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = CreateEventTypeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const [calendar] = await db.select().from(schedulingCalendarsTable)
    .where(and(eq(schedulingCalendarsTable.id, parsed.data.calendarId), eq(schedulingCalendarsTable.userId, clerkId)));
  if (!calendar) { res.status(404).json({ error: "Calendar not found" }); return; }

  const existing = await db.select().from(eventTypesTable)
    .where(eq(eventTypesTable.slug, parsed.data.slug))
    .then(r => r[0]);
  if (existing) { res.status(400).json({ error: "Slug already taken" }); return; }

  const [row] = await db.insert(eventTypesTable)
    .values({ ...parsed.data, userId: clerkId })
    .returning();
  res.status(201).json(GetEventTypeResponse.parse(row));
});

router.get("/scheduling/event-types/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = GetEventTypeParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Validation failed", issues: params.error.issues }); return; }
  const [row] = await db.select().from(eventTypesTable)
    .where(and(eq(eventTypesTable.id, params.data.id), eq(eventTypesTable.userId, clerkId)));
  if (!row) { res.status(404).json({ error: "Event type not found" }); return; }
  res.json(GetEventTypeResponse.parse(row));
});

router.patch("/scheduling/event-types/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = UpdateEventTypeParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Validation failed", issues: params.error.issues }); return; }
  const parsed = UpdateEventTypeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  const [row] = await db.update(eventTypesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(eventTypesTable.id, params.data.id), eq(eventTypesTable.userId, clerkId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Event type not found" }); return; }
  res.json(UpdateEventTypeResponse.parse(row));
});

router.delete("/scheduling/event-types/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = DeleteEventTypeParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Validation failed", issues: params.error.issues }); return; }
  const [row] = await db.delete(eventTypesTable)
    .where(and(eq(eventTypesTable.id, params.data.id), eq(eventTypesTable.userId, clerkId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Event type not found" }); return; }
  res.sendStatus(204);
});

export default router;

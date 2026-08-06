import { Router, type IRouter } from "express";
import { format } from "date-fns";
import { eq, and } from "drizzle-orm";
import { db, availabilitySchedulesTable, availabilityOverridesTable, schedulingCalendarsTable } from "@workspace/db";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { clientContext } from "../../middlewares/clientContext.js";
import {
  CreateAvailabilityBody,
  UpdateAvailabilityBody,
  UpdateAvailabilityParams,
  DeleteAvailabilityParams,
  ListAvailabilityQueryParams,
  ListAvailabilityResponse,
  UpdateAvailabilityResponse,
  CreateAvailabilityOverrideBody,
  ListAvailabilityOverridesQueryParams,
  ListAvailabilityOverridesResponse,
  DeleteAvailabilityOverrideParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function assertCalendarOwner(calendarId: number, userId: string): Promise<boolean> {
  const [cal] = await db.select().from(schedulingCalendarsTable)
    .where(and(eq(schedulingCalendarsTable.id, calendarId), eq(schedulingCalendarsTable.userId, userId)));
  return !!cal;
}

router.get("/scheduling/availability", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const qp = ListAvailabilityQueryParams.safeParse(req.query);
  if (!qp.success) { res.status(400).json({ error: "Validation failed", issues: qp.error.issues }); return; }
  if (!(await assertCalendarOwner(qp.data.calendarId, clerkId))) {
    res.status(404).json({ error: "Calendar not found" }); return;
  }
  const rows = await db.select().from(availabilitySchedulesTable)
    .where(eq(availabilitySchedulesTable.calendarId, qp.data.calendarId));
  res.json(ListAvailabilityResponse.parse(rows));
});

router.post("/scheduling/availability", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = CreateAvailabilityBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  if (!(await assertCalendarOwner(parsed.data.calendarId, clerkId))) {
    res.status(404).json({ error: "Calendar not found" }); return;
  }
  const [row] = await db.insert(availabilitySchedulesTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/scheduling/availability/:id", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = UpdateAvailabilityParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Validation failed", issues: params.error.issues }); return; }
  const parsed = UpdateAvailabilityBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const [existing] = await db.select().from(availabilitySchedulesTable)
    .where(eq(availabilitySchedulesTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Availability not found" }); return; }
  if (!(await assertCalendarOwner(existing.calendarId, clerkId))) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const [row] = await db.update(availabilitySchedulesTable)
    .set(parsed.data)
    .where(eq(availabilitySchedulesTable.id, params.data.id))
    .returning();
  res.json(UpdateAvailabilityResponse.parse(row));
});

router.delete("/scheduling/availability/:id", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = DeleteAvailabilityParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Validation failed", issues: params.error.issues }); return; }
  const [existing] = await db.select().from(availabilitySchedulesTable)
    .where(eq(availabilitySchedulesTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Availability not found" }); return; }
  if (!(await assertCalendarOwner(existing.calendarId, clerkId))) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  await db.delete(availabilitySchedulesTable).where(eq(availabilitySchedulesTable.id, params.data.id));
  res.sendStatus(204);
});

router.get("/scheduling/overrides", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const qp = ListAvailabilityOverridesQueryParams.safeParse(req.query);
  if (!qp.success) { res.status(400).json({ error: "Validation failed", issues: qp.error.issues }); return; }
  if (!(await assertCalendarOwner(qp.data.calendarId, clerkId))) {
    res.status(404).json({ error: "Calendar not found" }); return;
  }
  const rows = await db.select().from(availabilityOverridesTable)
    .where(eq(availabilityOverridesTable.calendarId, qp.data.calendarId));
  res.json(ListAvailabilityOverridesResponse.parse(rows));
});

router.post("/scheduling/overrides", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = CreateAvailabilityOverrideBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  if (!(await assertCalendarOwner(parsed.data.calendarId, clerkId))) {
    res.status(404).json({ error: "Calendar not found" }); return;
  }
  const [row] = await db.insert(availabilityOverridesTable).values({
    ...parsed.data,
    date: format(parsed.data.date, "yyyy-MM-dd"),
  }).returning();
  res.status(201).json(row);
});

router.delete("/scheduling/overrides/:id", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = DeleteAvailabilityOverrideParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Validation failed", issues: params.error.issues }); return; }
  const [existing] = await db.select().from(availabilityOverridesTable)
    .where(eq(availabilityOverridesTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Override not found" }); return; }
  if (!(await assertCalendarOwner(existing.calendarId, clerkId))) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  await db.delete(availabilityOverridesTable).where(eq(availabilityOverridesTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;

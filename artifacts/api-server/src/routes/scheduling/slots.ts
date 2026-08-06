import { Router, type IRouter } from "express";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { clientContext } from "../../middlewares/clientContext.js";
import { getAvailableSlots } from "../../services/scheduling/slot-engine.js";
import { GetAvailableSlotsResponse } from "@workspace/api-zod";
import { eq, and } from "drizzle-orm";
import { db, eventTypesTable } from "@workspace/db";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const router: IRouter = Router();

router.get("/scheduling/slots", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const { eventTypeId: rawId, startDate, endDate } = req.query as Record<string, string>;
  const eventTypeId = parseInt(rawId);
  if (!rawId || isNaN(eventTypeId) || eventTypeId < 1) {
    res.status(400).json({ error: "eventTypeId must be a positive integer" }); return;
  }
  if (!startDate || !DATE_RE.test(startDate)) {
    res.status(400).json({ error: "startDate must be YYYY-MM-DD" }); return;
  }
  if (!endDate || !DATE_RE.test(endDate)) {
    res.status(400).json({ error: "endDate must be YYYY-MM-DD" }); return;
  }

  const [eventType] = await db.select().from(eventTypesTable)
    .where(and(eq(eventTypesTable.id, eventTypeId), eq(eventTypesTable.userId, clerkId)));
  if (!eventType) { res.status(404).json({ error: "Event type not found" }); return; }

  const slots = await getAvailableSlots(eventTypeId, startDate, endDate);
  res.json(GetAvailableSlotsResponse.parse(slots.map(s => ({
    slotStart: s.slotStart.toISOString(),
    slotEnd: s.slotEnd.toISOString(),
  }))));
});

export default router;

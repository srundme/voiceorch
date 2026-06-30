/**
 * Scheduled Callbacks / Auto-Redial routes
 * ─────────────────────────────────────────────────────────────────────────────
 * Let users view and manage their pending callbacks and no-answer redials.
 */

import { Router, type IRouter } from "express";
import { getAuth } from "../lib/auth-compat.js";
import { db, scheduledCallbacksTable, agentsTable } from "@workspace/db";
import { eq, and, desc, sql, or, ilike, inArray } from "drizzle-orm";

const router: IRouter = Router();

// ── GET /callbacks — list all callbacks for the authenticated user ─────────

router.get("/callbacks", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const status = String(req.query["status"] ?? "pending");
  const reason = String(req.query["reason"] ?? "all");
  const page   = Math.max(0, parseInt(String(req.query["page"] ?? "0"), 10) || 0);
  const limit  = Math.min(100, Math.max(1, parseInt(String(req.query["limit"] ?? "50"), 10) || 50));

  const agentIds = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(eq(agentsTable.userId, userId));
  const ids = agentIds.map(a => a.id);
  if (ids.length === 0) { res.json({ items: [], total: 0, page, limit }); return; }

  const conditions = [inArray(scheduledCallbacksTable.agentId, ids)];

  if (status === "pending") {
    conditions.push(eq(scheduledCallbacksTable.status, "pending"));
  } else if (status === "triggered") {
    conditions.push(eq(scheduledCallbacksTable.status, "triggered"));
  } else if (status === "cancelled") {
    conditions.push(or(
      eq(scheduledCallbacksTable.status, "cancelled"),
      eq(scheduledCallbacksTable.status, "failed"),
    )!);
  }

  if (reason === "callback_requested") {
    conditions.push(eq(scheduledCallbacksTable.reason, "callback_requested"));
  } else if (reason === "no_answer") {
    conditions.push(eq(scheduledCallbacksTable.reason, "no_answer"));
  } else if (reason === "network_drop") {
    conditions.push(eq(scheduledCallbacksTable.reason, "network_drop"));
  }

  const where = and(...conditions)!;

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(scheduledCallbacksTable)
    .where(where);

  const rows = await db
    .select({
      id:                    scheduledCallbacksTable.id,
      agentId:               scheduledCallbacksTable.agentId,
      agentName:             agentsTable.name,
      toNumber:              scheduledCallbacksTable.toNumber,
      scheduledAt:           scheduledCallbacksTable.scheduledAt,
      status:                scheduledCallbacksTable.status,
      reason:                scheduledCallbacksTable.reason,
      attemptCount:          scheduledCallbacksTable.attemptCount,
      maxAttempts:           scheduledCallbacksTable.maxAttempts,
      redialIntervalMinutes: scheduledCallbacksTable.redialIntervalMinutes,
      notes:                 scheduledCallbacksTable.notes,
      triggeredAt:           scheduledCallbacksTable.triggeredAt,
      cancelledAt:           scheduledCallbacksTable.cancelledAt,
      createdAt:             scheduledCallbacksTable.createdAt,
      originCallId:          scheduledCallbacksTable.createdFromCallId,
      triggeredCallId:       scheduledCallbacksTable.triggeredCallId,
    })
    .from(scheduledCallbacksTable)
    .innerJoin(agentsTable, eq(scheduledCallbacksTable.agentId, agentsTable.id))
    .where(where)
    .orderBy(desc(scheduledCallbacksTable.scheduledAt))
    .limit(limit)
    .offset(page * limit);

  const items = rows.map(r => ({
    id:                    r.id,
    agentId:               r.agentId,
    agentName:             r.agentName,
    toNumber:              r.toNumber,
    scheduledAt:           r.scheduledAt?.toISOString() ?? null,
    status:                r.status,
    reason:                r.reason ?? "callback_requested",
    attemptCount:          r.attemptCount,
    maxAttempts:           r.maxAttempts,
    redialIntervalMinutes: r.redialIntervalMinutes,
    notes:                 r.notes ?? null,
    triggeredAt:           r.triggeredAt?.toISOString() ?? null,
    cancelledAt:           r.cancelledAt?.toISOString() ?? null,
    createdAt:             r.createdAt.toISOString(),
    minutesUntilDue:       r.scheduledAt ? Math.round((r.scheduledAt.getTime() - Date.now()) / 60_000) : null,
    originCallId:          r.originCallId ?? null,
    triggeredCallId:       r.triggeredCallId ?? null,
  }));

  res.json({ items, total: countRow?.count ?? 0, page, limit });
});

// ── DELETE /callbacks/:id — cancel a pending callback ─────────────────────

router.delete("/callbacks/:id", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params["id"]!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [cb] = await db
    .select({ agentId: scheduledCallbacksTable.agentId, status: scheduledCallbacksTable.status })
    .from(scheduledCallbacksTable)
    .where(eq(scheduledCallbacksTable.id, id));

  if (!cb) { res.status(404).json({ error: "Not found" }); return; }

  const [agent] = await db
    .select({ userId: agentsTable.userId })
    .from(agentsTable)
    .where(eq(agentsTable.id, cb.agentId));

  if (agent?.userId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }
  if (cb.status !== "pending") { res.status(400).json({ error: "Only pending callbacks can be cancelled" }); return; }

  await db
    .update(scheduledCallbacksTable)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(eq(scheduledCallbacksTable.id, id));

  res.json({ id, status: "cancelled" });
});

// ── PATCH /callbacks/:id — reschedule a pending callback ──────────────────

router.patch("/callbacks/:id", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params["id"]!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { scheduledAt } = req.body as { scheduledAt?: string };
  if (!scheduledAt) { res.status(400).json({ error: "scheduledAt required" }); return; }

  const newDate = new Date(scheduledAt);
  if (isNaN(newDate.getTime())) { res.status(400).json({ error: "Invalid scheduledAt" }); return; }

  const [cb] = await db
    .select({ agentId: scheduledCallbacksTable.agentId, status: scheduledCallbacksTable.status })
    .from(scheduledCallbacksTable)
    .where(eq(scheduledCallbacksTable.id, id));

  if (!cb) { res.status(404).json({ error: "Not found" }); return; }

  const [agent] = await db
    .select({ userId: agentsTable.userId })
    .from(agentsTable)
    .where(eq(agentsTable.id, cb.agentId));

  if (agent?.userId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }

  await db
    .update(scheduledCallbacksTable)
    .set({ scheduledAt: newDate, status: "pending", cancelledAt: null })
    .where(eq(scheduledCallbacksTable.id, id));

  res.json({ id, scheduledAt: newDate.toISOString(), status: "pending" });
});

// ── GET /callbacks/stats — quick summary ─────────────────────────────────

router.get("/callbacks/stats", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const agentIds = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(eq(agentsTable.userId, userId));
  const ids = agentIds.map(a => a.id);
  if (ids.length === 0) {
    res.json({ pendingCallbacks: 0, pendingRedials: 0, pendingNetworkDrops: 0, dueNow: 0 });
    return;
  }

  const [m] = await db
    .select({
      pendingCallbacks:     sql<number>`count(*) filter (where ${scheduledCallbacksTable.status} = 'pending' and ${scheduledCallbacksTable.reason} = 'callback_requested')::int`,
      pendingRedials:     sql<number>`count(*) filter (where ${scheduledCallbacksTable.status} = 'pending' and ${scheduledCallbacksTable.reason} = 'no_answer')::int`,
      pendingNetworkDrops: sql<number>`count(*) filter (where ${scheduledCallbacksTable.status} = 'pending' and ${scheduledCallbacksTable.reason} = 'network_drop')::int`,
      dueNow:             sql<number>`count(*) filter (where ${scheduledCallbacksTable.status} = 'pending' and ${scheduledCallbacksTable.scheduledAt} <= now())::int`,
    })
    .from(scheduledCallbacksTable)
    .where(inArray(scheduledCallbacksTable.agentId, ids));

  res.json({
    pendingCallbacks:     m?.pendingCallbacks     ?? 0,
    pendingRedials:       m?.pendingRedials       ?? 0,
    pendingNetworkDrops:  m?.pendingNetworkDrops  ?? 0,
    dueNow:               m?.dueNow               ?? 0,
  });
});

export default router;

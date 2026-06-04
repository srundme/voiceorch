/**
 * Campaign Callbacks routes — Phase 3B
 * ─────────────────────────────────────────────────────────────────────────────
 * Dedicated callback management workspace. SLA-first: every row surfaces
 * when the callback is due and whether the response window is breached.
 */

import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import {
  db, campaignsTable, campaignLeadsTable, callCallbacksTable,
} from "@workspace/db";
import { eq, and, sql, desc, or, inArray, ilike } from "drizzle-orm";

const router: IRouter = Router();

async function requireCampaign(campaignId: number, userId: string) {
  const [row] = await db.select({ id: campaignsTable.id })
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
  return row ?? null;
}

function slaStatus(responseDueBy: Date | null | undefined): "overdue" | "due-soon" | "ok" | null {
  if (!responseDueBy) return null;
  const diff = responseDueBy.getTime() - Date.now();
  if (diff < 0) return "overdue";
  if (diff < 15 * 60 * 1000) return "due-soon";
  return "ok";
}

// ── GET /campaigns/:id/callbacks/metrics ──────────────────────────────────────

router.get("/campaigns/:id/callbacks/metrics", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  if (isNaN(campaignId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const [m] = await db.select({
    pending:   sql<number>`count(*) filter (where ${callCallbacksTable.status} = 'pending')::int`,
    overdue:   sql<number>`count(*) filter (where ${callCallbacksTable.status} = 'pending' and ${callCallbacksTable.responseDueBy} < now())::int`,
    dueNow:    sql<number>`count(*) filter (where ${callCallbacksTable.status} = 'pending' and ${callCallbacksTable.responseDueBy} >= now() and ${callCallbacksTable.responseDueBy} < now() + interval '1 hour')::int`,
    dueToday:  sql<number>`count(*) filter (where ${callCallbacksTable.status} = 'pending' and date(${callCallbacksTable.callbackAt} at time zone 'UTC') = current_date)::int`,
    completed: sql<number>`count(*) filter (where ${callCallbacksTable.status} = 'completed')::int`,
  }).from(callCallbacksTable).where(eq(callCallbacksTable.campaignId, campaignId));

  res.json({
    pending:   m?.pending ?? 0,
    overdue:   m?.overdue ?? 0,
    dueNow:    m?.dueNow ?? 0,
    dueToday:  m?.dueToday ?? 0,
    completed: m?.completed ?? 0,
  });
});

// ── GET /campaigns/:id/callbacks ──────────────────────────────────────────────

router.get("/campaigns/:id/callbacks", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  if (isNaN(campaignId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const status = String(req.query["status"] ?? "pending");
  const search = String(req.query["search"] ?? "").trim();
  const page   = Math.max(0, parseInt(String(req.query["page"] ?? "0"), 10) || 0);
  const limit  = Math.min(100, Math.max(1, parseInt(String(req.query["limit"] ?? "50"), 10) || 50));

  const conditions = [eq(callCallbacksTable.campaignId, campaignId)];

  if (status === "overdue") {
    conditions.push(eq(callCallbacksTable.status, "pending"));
    conditions.push(sql`${callCallbacksTable.responseDueBy} < now()`);
  } else if (status === "due-now") {
    conditions.push(eq(callCallbacksTable.status, "pending"));
    conditions.push(sql`${callCallbacksTable.responseDueBy} >= now()`);
    conditions.push(sql`${callCallbacksTable.responseDueBy} < now() + interval '1 hour'`);
  } else if (status === "due-today") {
    conditions.push(eq(callCallbacksTable.status, "pending"));
    conditions.push(sql`date(${callCallbacksTable.callbackAt} at time zone 'UTC') = current_date`);
  } else if (status === "completed") {
    conditions.push(eq(callCallbacksTable.status, "completed"));
  } else if (status === "pending") {
    conditions.push(eq(callCallbacksTable.status, "pending"));
  }
  // "all" — no status filter

  if (search) {
    conditions.push(or(
      ilike(campaignLeadsTable.phone, `%${search}%`),
      ilike(campaignLeadsTable.name!, `%${search}%`),
    )!);
  }

  const where = and(...conditions)!;

  const [countRow] = await db.select({ count: sql<number>`count(*)::int` })
    .from(callCallbacksTable)
    .innerJoin(campaignLeadsTable, eq(callCallbacksTable.leadId, campaignLeadsTable.id))
    .where(where);
  const total = countRow?.count ?? 0;

  const rows = await db.select({
    id:            callCallbacksTable.id,
    leadId:        callCallbacksTable.leadId,
    callbackAt:    callCallbacksTable.callbackAt,
    responseDueBy: callCallbacksTable.responseDueBy,
    reason:        callCallbacksTable.reason,
    rawExtract:    callCallbacksTable.rawExtract,
    status:        callCallbacksTable.status,
    createdAt:     callCallbacksTable.createdAt,
    leadName:      campaignLeadsTable.name,
    leadPhone:     campaignLeadsTable.phone,
    leadCallAttempts: campaignLeadsTable.callAttempts,
    leadDisposition:  campaignLeadsTable.disposition,
    leadCallStatus:   campaignLeadsTable.callStatus,
  }).from(callCallbacksTable)
    .innerJoin(campaignLeadsTable, eq(callCallbacksTable.leadId, campaignLeadsTable.id))
    .where(where)
    .orderBy(
      sql`case when ${callCallbacksTable.status} = 'pending' then 0 else 1 end`,
      sql`coalesce(${callCallbacksTable.responseDueBy}, ${callCallbacksTable.callbackAt}) asc nulls last`,
    )
    .limit(limit)
    .offset(page * limit);

  const items = rows.map(r => {
    const rawReason = r.rawExtract && r.rawExtract.length <= 80 ? r.rawExtract : null;
    return {
      id:            r.id,
      leadId:        r.leadId,
      callbackAt:    r.callbackAt?.toISOString() ?? null,
      responseDueBy: r.responseDueBy?.toISOString() ?? null,
      slaStatus:     slaStatus(r.responseDueBy),
      reason:        r.reason ?? rawReason ?? null,
      status:        r.status,
      createdAt:     r.createdAt.toISOString(),
      lead: {
        name:        r.leadName ?? null,
        phone:       r.leadPhone,
        callAttempts: r.leadCallAttempts,
        disposition: r.leadDisposition ?? null,
        callStatus:  r.leadCallStatus,
      },
    };
  });

  res.json({ items, total, page, limit });
});

// ── POST /campaigns/:id/callbacks/:callbackId/complete ────────────────────────

router.post("/campaigns/:id/callbacks/:callbackId/complete", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const callbackId = parseInt(req.params["callbackId"]!, 10);
  if (isNaN(campaignId) || isNaN(callbackId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const [row] = await db.update(callCallbacksTable)
    .set({ status: "completed" })
    .where(and(eq(callCallbacksTable.id, callbackId), eq(callCallbacksTable.campaignId, campaignId)))
    .returning({ id: callCallbacksTable.id });

  if (!row) { res.status(404).json({ error: "Callback not found" }); return; }
  res.json({ id: row.id, status: "completed" });
});

// ── POST /campaigns/:id/callbacks/:callbackId/reschedule ──────────────────────

router.post("/campaigns/:id/callbacks/:callbackId/reschedule", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const callbackId = parseInt(req.params["callbackId"]!, 10);
  if (isNaN(campaignId) || isNaN(callbackId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const { callbackAt } = req.body as { callbackAt?: string };
  if (!callbackAt) { res.status(400).json({ error: "callbackAt required" }); return; }

  const newDate = new Date(callbackAt);
  if (isNaN(newDate.getTime())) { res.status(400).json({ error: "Invalid callbackAt" }); return; }

  const [row] = await db.update(callCallbacksTable)
    .set({ callbackAt: newDate, status: "pending" })
    .where(and(eq(callCallbacksTable.id, callbackId), eq(callCallbacksTable.campaignId, campaignId)))
    .returning({ id: callCallbacksTable.id });

  if (!row) { res.status(404).json({ error: "Callback not found" }); return; }
  res.json({ id: row.id, callbackAt: newDate.toISOString() });
});

// ── POST /campaigns/:id/callbacks/bulk-action ─────────────────────────────────

router.post("/campaigns/:id/callbacks/bulk-action", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  if (isNaN(campaignId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const { action, callbackIds, callbackAt } = req.body as {
    action: string;
    callbackIds: number[];
    callbackAt?: string;
  };

  if (!Array.isArray(callbackIds) || callbackIds.length === 0) {
    res.status(400).json({ error: "callbackIds required" }); return;
  }

  const owned = await db.select({ id: callCallbacksTable.id })
    .from(callCallbacksTable)
    .where(and(inArray(callCallbacksTable.id, callbackIds), eq(callCallbacksTable.campaignId, campaignId)));
  const ownedIds = owned.map(r => r.id);
  if (ownedIds.length === 0) { res.json({ action, affected: 0 }); return; }

  if (action === "complete") {
    await db.update(callCallbacksTable)
      .set({ status: "completed" })
      .where(inArray(callCallbacksTable.id, ownedIds));
  } else if (action === "reschedule") {
    if (!callbackAt) { res.status(400).json({ error: "callbackAt required for reschedule" }); return; }
    const newDate = new Date(callbackAt);
    if (isNaN(newDate.getTime())) { res.status(400).json({ error: "Invalid callbackAt" }); return; }
    await db.update(callCallbacksTable)
      .set({ callbackAt: newDate, status: "pending" })
      .where(inArray(callCallbacksTable.id, ownedIds));
  } else {
    res.status(400).json({ error: "Invalid action" }); return;
  }

  res.json({ action, affected: ownedIds.length });
});

// ── GET /campaigns/:id/callbacks/export ───────────────────────────────────────

router.get("/campaigns/:id/callbacks/export", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  if (isNaN(campaignId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const status = String(req.query["status"] ?? "pending");
  const conditions = [eq(callCallbacksTable.campaignId, campaignId)];
  if (status !== "all") conditions.push(eq(callCallbacksTable.status, status));

  const rows = await db.select({
    id:            callCallbacksTable.id,
    callbackAt:    callCallbacksTable.callbackAt,
    responseDueBy: callCallbacksTable.responseDueBy,
    reason:        callCallbacksTable.reason,
    status:        callCallbacksTable.status,
    leadName:      campaignLeadsTable.name,
    leadPhone:     campaignLeadsTable.phone,
    callAttempts:  campaignLeadsTable.callAttempts,
    disposition:   campaignLeadsTable.disposition,
  }).from(callCallbacksTable)
    .innerJoin(campaignLeadsTable, eq(callCallbacksTable.leadId, campaignLeadsTable.id))
    .where(and(...conditions)!)
    .orderBy(sql`coalesce(${callCallbacksTable.responseDueBy}, ${callCallbacksTable.callbackAt}) asc nulls last`)
    .limit(5000);

  const headers = ["ID", "Lead Name", "Phone", "Callback At", "Response Due By", "SLA Status", "Reason", "Status", "Attempts", "Disposition"];
  const csvRows = rows.map(r => [
    r.id, r.leadName ?? "", r.leadPhone,
    r.callbackAt?.toISOString() ?? "",
    r.responseDueBy?.toISOString() ?? "",
    slaStatus(r.responseDueBy) ?? "",
    r.reason ?? "", r.status,
    r.callAttempts, r.disposition ?? "",
  ].join(","));

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="callbacks-${campaignId}.csv"`);
  res.send([headers.join(","), ...csvRows].join("\n"));
});

export default router;

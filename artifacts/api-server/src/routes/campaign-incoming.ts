/**
 * Campaign Incoming Calls routes — Phase 3C
 * ─────────────────────────────────────────────────────────────────────────────
 * "Who called us back?" — tracks inbound calls matched to a campaign.
 * Uses incoming_call_status (unreviewed / reviewed / actioned) which is
 * separate from disposition — different concepts.
 */

import { Router, type IRouter } from "express";
import { getAuth } from "../lib/auth-compat.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext } from "../middlewares/clientContext.js";
import {
  db, campaignsTable, campaignLeadsTable, callsTable,
  incomingCallsTable, callCallbacksTable, callExecutionsTable,
} from "@workspace/db";
import { eq, and, sql, desc, or, inArray, ilike } from "drizzle-orm";

const router: IRouter = Router();

router.use(requireAuth, clientContext);

async function requireCampaign(campaignId: number, userId: string) {
  const [row] = await db.select({ id: campaignsTable.id })
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
  return row ?? null;
}

// ── GET /campaigns/:id/incoming/metrics ───────────────────────────────────────

router.get("/campaigns/:id/incoming/metrics", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  if (isNaN(campaignId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const [m] = await db.select({
    unreviewed: sql<number>`count(*) filter (where ${incomingCallsTable.incomingCallStatus} = 'unreviewed')::int`,
    today:      sql<number>`count(*) filter (where date(${incomingCallsTable.createdAt} at time zone 'UTC') = current_date)::int`,
    thisWeek:   sql<number>`count(*) filter (where ${incomingCallsTable.createdAt} >= date_trunc('week', now()))::int`,
    completed:  sql<number>`count(*) filter (where ${incomingCallsTable.incomingCallStatus} in ('reviewed', 'actioned'))::int`,
    total:      sql<number>`count(*)::int`,
  }).from(incomingCallsTable)
    .where(eq(incomingCallsTable.campaignId, campaignId));

  res.json({
    unreviewed: m?.unreviewed ?? 0,
    today:      m?.today ?? 0,
    thisWeek:   m?.thisWeek ?? 0,
    completed:  m?.completed ?? 0,
    total:      m?.total ?? 0,
  });
});

// ── GET /campaigns/:id/incoming ───────────────────────────────────────────────

router.get("/campaigns/:id/incoming", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  if (isNaN(campaignId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const status = String(req.query["status"] ?? "all");
  const search = String(req.query["search"] ?? "").trim();
  const page   = Math.max(0, parseInt(String(req.query["page"] ?? "0"), 10) || 0);
  const limit  = Math.min(100, Math.max(1, parseInt(String(req.query["limit"] ?? "50"), 10) || 50));

  const conditions = [eq(incomingCallsTable.campaignId, campaignId)];

  if (status === "unreviewed") conditions.push(eq(incomingCallsTable.incomingCallStatus, "unreviewed"));
  else if (status === "reviewed") conditions.push(eq(incomingCallsTable.incomingCallStatus, "reviewed"));
  else if (status === "actioned") conditions.push(eq(incomingCallsTable.incomingCallStatus, "actioned"));
  else if (status === "completed") conditions.push(
    sql`${incomingCallsTable.incomingCallStatus} in ('reviewed', 'actioned')`,
  );

  if (search) {
    conditions.push(or(
      ilike(incomingCallsTable.phone, `%${search}%`),
      ilike(campaignLeadsTable.name!, `%${search}%`),
    )!);
  }

  const where = and(...conditions)!;

  const [countRow] = await db.select({ count: sql<number>`count(*)::int` })
    .from(incomingCallsTable)
    .leftJoin(campaignLeadsTable, eq(incomingCallsTable.leadId, campaignLeadsTable.id))
    .where(where);
  const total = countRow?.count ?? 0;

  const rows = await db.select({
    id:                 incomingCallsTable.id,
    phone:              incomingCallsTable.phone,
    leadId:             incomingCallsTable.leadId,
    callId:             incomingCallsTable.callId,
    incomingCallStatus: incomingCallsTable.incomingCallStatus,
    incomingCallReason: incomingCallsTable.incomingCallReason,
    matchedAt:          incomingCallsTable.matchedAt,
    createdAt:          incomingCallsTable.createdAt,
    leadName:           campaignLeadsTable.name,
    leadCallAttempts:   campaignLeadsTable.callAttempts,
    leadDisposition:    campaignLeadsTable.disposition,
    callDuration:       callsTable.durationSeconds,
  }).from(incomingCallsTable)
    .leftJoin(campaignLeadsTable, eq(incomingCallsTable.leadId, campaignLeadsTable.id))
    .leftJoin(callsTable, eq(incomingCallsTable.callId, callsTable.id))
    .where(where)
    .orderBy(desc(incomingCallsTable.createdAt))
    .limit(limit)
    .offset(page * limit);

  if (rows.length === 0) { res.json({ items: [], total, page, limit }); return; }

  // Fetch detected intent from call_executions for matched calls
  const callIds = rows.filter(r => r.callId).map(r => r.callId!);
  const intentMap = new Map<number, string | null>();
  if (callIds.length > 0) {
    const execs = await db.select({ callId: callExecutionsTable.callId, detectedIntent: callExecutionsTable.detectedIntent })
      .from(callExecutionsTable)
      .where(inArray(callExecutionsTable.callId!, callIds))
      .orderBy(desc(callExecutionsTable.createdAt));
    for (const e of execs) {
      if (e.callId && !intentMap.has(e.callId)) intentMap.set(e.callId, e.detectedIntent ?? null);
    }
  }

  const items = rows.map(r => ({
    id:                 r.id,
    phone:              r.phone,
    leadId:             r.leadId ?? null,
    callId:             r.callId ?? null,
    incomingCallStatus: r.incomingCallStatus,
    incomingCallReason: r.incomingCallReason ?? null,
    receivedAt:         r.createdAt.toISOString(),
    matchedAt:          r.matchedAt?.toISOString() ?? null,
    durationSeconds:    r.callDuration ?? null,
    detectedIntent:     r.callId ? (intentMap.get(r.callId) ?? null) : null,
    lead: r.leadId ? {
      name:        r.leadName ?? null,
      callAttempts: r.leadCallAttempts ?? 0,
      disposition: r.leadDisposition ?? null,
    } : null,
  }));

  res.json({ items, total, page, limit });
});

// ── PATCH /campaigns/:id/incoming/:incomingId/status ──────────────────────────

router.patch("/campaigns/:id/incoming/:incomingId/status", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId  = parseInt(req.params["id"]!, 10);
  const incomingId  = parseInt(req.params["incomingId"]!, 10);
  if (isNaN(campaignId) || isNaN(incomingId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const { status } = req.body as { status?: string };
  if (!status || !["reviewed", "actioned", "unreviewed"].includes(status)) {
    res.status(400).json({ error: "status must be reviewed | actioned | unreviewed" }); return;
  }

  const [row] = await db.update(incomingCallsTable)
    .set({ incomingCallStatus: status })
    .where(and(
      eq(incomingCallsTable.id, incomingId),
      eq(incomingCallsTable.campaignId, campaignId),
    ))
    .returning({ id: incomingCallsTable.id });

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ id: row.id, incomingCallStatus: status });
});

// ── POST /campaigns/:id/incoming/:incomingId/create-callback ──────────────────

router.post("/campaigns/:id/incoming/:incomingId/create-callback", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId  = parseInt(req.params["id"]!, 10);
  const incomingId  = parseInt(req.params["incomingId"]!, 10);
  if (isNaN(campaignId) || isNaN(incomingId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const [incoming] = await db.select()
    .from(incomingCallsTable)
    .where(and(eq(incomingCallsTable.id, incomingId), eq(incomingCallsTable.campaignId, campaignId)));

  if (!incoming) { res.status(404).json({ error: "Not found" }); return; }
  if (!incoming.leadId) { res.status(400).json({ error: "No matched lead — cannot create callback" }); return; }

  const { callbackAt, reason } = req.body as { callbackAt?: string; reason?: string };
  const callbackDate = callbackAt ? new Date(callbackAt) : new Date(Date.now() + 60 * 60_000);
  if (isNaN(callbackDate.getTime())) { res.status(400).json({ error: "Invalid callbackAt" }); return; }

  const [cb] = await db.insert(callCallbacksTable).values({
    leadId:       incoming.leadId,
    campaignId:   campaignId,
    callId:       incoming.callId ?? undefined,
    callbackAt:   callbackDate,
    reason:       reason ?? "Incoming call follow-up",
    status:       "pending",
  }).returning({ id: callCallbacksTable.id });

  // Auto-mark as actioned
  await db.update(incomingCallsTable)
    .set({ incomingCallStatus: "actioned" })
    .where(eq(incomingCallsTable.id, incomingId));

  res.json({ callbackId: cb?.id, callbackAt: callbackDate.toISOString(), leadId: incoming.leadId });
});

// ── GET /campaigns/:id/incoming/export ────────────────────────────────────────

router.get("/campaigns/:id/incoming/export", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  if (isNaN(campaignId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const status = String(req.query["status"] ?? "all");
  const conditions = [eq(incomingCallsTable.campaignId, campaignId)];
  if (status !== "all") conditions.push(eq(incomingCallsTable.incomingCallStatus, status));

  const rows = await db.select({
    id:                 incomingCallsTable.id,
    phone:              incomingCallsTable.phone,
    incomingCallStatus: incomingCallsTable.incomingCallStatus,
    createdAt:          incomingCallsTable.createdAt,
    leadName:           campaignLeadsTable.name,
    leadDisposition:    campaignLeadsTable.disposition,
    callDuration:       callsTable.durationSeconds,
  }).from(incomingCallsTable)
    .leftJoin(campaignLeadsTable, eq(incomingCallsTable.leadId, campaignLeadsTable.id))
    .leftJoin(callsTable, eq(incomingCallsTable.callId, callsTable.id))
    .where(and(...conditions)!)
    .orderBy(desc(incomingCallsTable.createdAt))
    .limit(5000);

  const headers = ["ID", "Phone", "Lead Name", "Duration (s)", "Disposition", "Status", "Received At"];
  const csvRows = rows.map(r => [
    r.id, r.phone, r.leadName ?? "",
    r.callDuration ?? "", r.leadDisposition ?? "",
    r.incomingCallStatus, r.createdAt.toISOString(),
  ].join(","));

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="incoming-${campaignId}.csv"`);
  res.send([headers.join(","), ...csvRows].join("\n"));
});

export default router;

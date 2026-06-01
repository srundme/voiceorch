import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import {
  db, campaignsTable, campaignBatchesTable, campaignLeadsTable, callsTable,
  type CampaignFieldMappings,
} from "@workspace/db";
import { eq, and, count, desc, inArray, sql } from "drizzle-orm";
import { scheduleCampaignCall } from "../orchestration/campaignCaller.js";

const router: IRouter = Router();

type CampaignRow = typeof campaignsTable.$inferSelect;
type BatchRow    = typeof campaignBatchesTable.$inferSelect;

function toBatch(row: BatchRow) {
  return {
    id:               row.id,
    campaignId:       row.campaignId,
    name:             row.name,
    status:           row.status,
    scheduledStartAt: row.scheduledStartAt?.toISOString() ?? null,
    totalLeads:       row.totalLeads,
    calledLeads:      row.calledLeads,
    createdAt:        row.createdAt.toISOString(),
    updatedAt:        row.updatedAt.toISOString(),
  };
}

async function requireCampaign(campaignId: number, userId: string): Promise<CampaignRow | null> {
  const [row] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
  return row ?? null;
}

async function requireBatch(batchId: number, campaignId: number): Promise<BatchRow | null> {
  const [row] = await db.select().from(campaignBatchesTable)
    .where(and(eq(campaignBatchesTable.id, batchId), eq(campaignBatchesTable.campaignId, campaignId)));
  return row ?? null;
}

async function fireStartBatch(batch: BatchRow, campaign: CampaignRow): Promise<void> {
  const pending = await db.select().from(campaignLeadsTable)
    .where(and(
      eq(campaignLeadsTable.campaignId, campaign.id),
      sql`${campaignLeadsTable.batchId} = ${batch.id}`,
      eq(campaignLeadsTable.callStatus, "pending"),
    ));
  for (const lead of pending) {
    scheduleCampaignCall(lead, campaign);
  }
}

// ── GET /campaigns/:id/batches ────────────────────────────────────────────────
router.get("/campaigns/:id/batches", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const batches = await db.select().from(campaignBatchesTable)
    .where(eq(campaignBatchesTable.campaignId, campaignId))
    .orderBy(desc(campaignBatchesTable.createdAt));

  res.json(batches.map(toBatch));
});

// ── POST /campaigns/:id/batches ───────────────────────────────────────────────
router.post("/campaigns/:id/batches", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const body = req.body as { name?: string; leads?: unknown; scheduledStartAt?: string | null };
  if (!body.name?.trim()) { res.status(400).json({ error: "Batch name required" }); return; }
  if (!Array.isArray(body.leads)) { res.status(400).json({ error: "leads must be an array" }); return; }

  const rawLeads   = body.leads as Record<string, string>[];
  const mappings   = campaign.fieldMappings as CampaignFieldMappings;
  const phoneField = mappings.phone ?? "phone";
  const nameField  = mappings.name  ?? "name";
  const emailField = mappings.email ?? "email";

  const [batch] = await db.insert(campaignBatchesTable).values({
    campaignId,
    name: body.name.trim(),
    scheduledStartAt: body.scheduledStartAt ? new Date(body.scheduledStartAt) : null,
  }).returning();

  const toInsert: (typeof campaignLeadsTable.$inferInsert)[] = [];
  for (const row of rawLeads) {
    const phone = (row[phoneField] ?? row["phone"] ?? "").trim();
    if (!phone) continue;
    const name  = (row[nameField]  ?? row["name"]  ?? "").trim() || null;
    const email = (row[emailField] ?? row["email"] ?? "").trim() || null;
    const leadData: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) { if (v?.trim()) leadData[k] = v.trim(); }
    toInsert.push({ campaignId, batchId: batch!.id, phone, name, email, leadData, source: "csv" });
  }

  const imported = toInsert.length;
  if (imported > 0) {
    for (let i = 0; i < toInsert.length; i += 100) {
      await db.insert(campaignLeadsTable).values(toInsert.slice(i, i + 100));
    }
    await db.update(campaignBatchesTable).set({ totalLeads: imported }).where(eq(campaignBatchesTable.id, batch!.id));
    await db.update(campaignsTable)
      .set({ totalLeads: campaign.totalLeads + imported })
      .where(eq(campaignsTable.id, campaignId));
  }

  const [fresh] = await db.select().from(campaignBatchesTable).where(eq(campaignBatchesTable.id, batch!.id));

  // If scheduledStartAt is already past (or absent and user wants immediate), start at scheduled time via poller.
  // If scheduled time is in the past, fire immediately.
  if (fresh && fresh.scheduledStartAt && fresh.scheduledStartAt <= new Date()) {
    await db.update(campaignBatchesTable).set({ status: "running" }).where(eq(campaignBatchesTable.id, fresh.id));
    await fireStartBatch(fresh, campaign);
  }

  res.status(201).json(toBatch(fresh!));
});

// ── GET /campaigns/:id/batches/:batchId ──────────────────────────────────────
router.get("/campaigns/:id/batches/:batchId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const batchId    = parseInt(req.params["batchId"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const batch = await requireBatch(batchId, campaignId);
  if (!batch) { res.status(404).json({ error: "Not found" }); return; }

  res.json(toBatch(batch));
});

// ── PATCH /campaigns/:id/batches/:batchId ─────────────────────────────────────
router.patch("/campaigns/:id/batches/:batchId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const batchId    = parseInt(req.params["batchId"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const batch = await requireBatch(batchId, campaignId);
  if (!batch) { res.status(404).json({ error: "Not found" }); return; }

  const body = req.body as { status?: string; scheduledStartAt?: string | null };
  const updateData: Partial<typeof campaignBatchesTable.$inferInsert> = {};
  if (body.status) updateData.status = body.status;
  if ("scheduledStartAt" in body) {
    updateData.scheduledStartAt = body.scheduledStartAt ? new Date(body.scheduledStartAt) : null;
  }

  const [updated] = await db.update(campaignBatchesTable)
    .set(updateData)
    .where(eq(campaignBatchesTable.id, batchId))
    .returning();

  // Fire calls when transitioning to 'running'
  if (body.status === "running" && batch.status !== "running") {
    await fireStartBatch(updated!, campaign);
  }

  res.json(toBatch(updated!));
});

// ── DELETE /campaigns/:id/batches/:batchId ────────────────────────────────────
router.delete("/campaigns/:id/batches/:batchId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const batchId    = parseInt(req.params["batchId"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const batch = await requireBatch(batchId, campaignId);
  if (!batch) { res.status(404).json({ error: "Not found" }); return; }

  await db.delete(campaignBatchesTable).where(eq(campaignBatchesTable.id, batchId));
  await db.update(campaignsTable)
    .set({ totalLeads: Math.max(0, campaign.totalLeads - batch.totalLeads) })
    .where(eq(campaignsTable.id, campaignId));

  res.status(204).end();
});

// ── GET /campaigns/:id/batches/:batchId/leads ─────────────────────────────────
router.get("/campaigns/:id/batches/:batchId/leads", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const batchId    = parseInt(req.params["batchId"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const batch = await requireBatch(batchId, campaignId);
  if (!batch) { res.status(404).json({ error: "Not found" }); return; }

  const limitVal  = Math.min(parseInt(String(req.query["limit"] ?? "50"), 10), 200);
  const offsetVal = parseInt(String(req.query["offset"] ?? "0"), 10);
  const filter    = String(req.query["filter"] ?? "all");

  const baseWhere = and(
    eq(campaignLeadsTable.campaignId, campaignId),
    sql`${campaignLeadsTable.batchId} = ${batchId}`,
  );

  let whereClause = baseWhere;
  if (filter === "no_pickup") {
    whereClause = and(baseWhere, inArray(campaignLeadsTable.callStatus, ["failed", "skipped"]));
  } else if (filter !== "all" && filter !== "inbound" && filter !== "callbacks") {
    whereClause = and(baseWhere, eq(campaignLeadsTable.disposition, filter));
  }

  const [leads, [{ total }]] = await Promise.all([
    db.select().from(campaignLeadsTable)
      .where(whereClause)
      .orderBy(desc(campaignLeadsTable.createdAt))
      .limit(limitVal).offset(offsetVal),
    db.select({ total: count() }).from(campaignLeadsTable).where(whereClause),
  ]);

  const callIds = leads.filter(l => l.callId).map(l => l.callId!);
  const callsMap = new Map<number, typeof callsTable.$inferSelect>();
  if (callIds.length > 0) {
    const calls = await db.select().from(callsTable).where(inArray(callsTable.id, callIds));
    for (const c of calls) callsMap.set(c.id, c);
  }

  const items = leads.map(lead => {
    const call = lead.callId ? callsMap.get(lead.callId) : undefined;
    return {
      id:              lead.id,
      campaignId:      lead.campaignId,
      campaignName:    campaign.name,
      batchId:         lead.batchId ?? null,
      batchName:       batch.name,
      phone:           lead.phone,
      name:            lead.name ?? null,
      callStatus:      lead.callStatus,
      disposition:     lead.disposition ?? null,
      callId:          lead.callId ?? null,
      fromNumber:      call?.fromNumber ?? null,
      toNumber:        call?.toNumber ?? null,
      durationSeconds: call?.durationSeconds ?? null,
      source:          lead.source,
      hasCallback:     false,
      callbackStatus:  null as string | null,
      createdAt:       lead.createdAt.toISOString(),
    };
  });

  res.json({ leads: items, total: Number(total) });
});

// ── POST /campaigns/:id/batches/:batchId/redial ───────────────────────────────
router.post("/campaigns/:id/batches/:batchId/redial", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const batchId    = parseInt(req.params["batchId"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const batch = await requireBatch(batchId, campaignId);
  if (!batch) { res.status(404).json({ error: "Not found" }); return; }

  const noPickup = await db.select().from(campaignLeadsTable)
    .where(and(
      eq(campaignLeadsTable.campaignId, campaignId),
      sql`${campaignLeadsTable.batchId} = ${batchId}`,
      inArray(campaignLeadsTable.callStatus, ["failed", "skipped"]),
    ));

  let queued = 0;
  for (const lead of noPickup) {
    const [updated] = await db.update(campaignLeadsTable)
      .set({ callStatus: "pending", notes: null })
      .where(eq(campaignLeadsTable.id, lead.id))
      .returning();
    if (updated) { scheduleCampaignCall(updated, campaign); queued++; }
  }

  res.json({ queued });
});

export default router;

/**
 * Campaign Analytics routes
 * ─────────────────────────────────────────────────────────────────────────────
 * Batch analytics, disposition breakdown, and DNC management.
 */

import { Router, type IRouter } from "express";
import { getAuth } from "../lib/auth-compat.js";
import {
  db, campaignsTable, campaignLeadsTable, campaignBatchesTable,
  callCallbacksTable, callRetriesTable, workspaceDncTable,
} from "@workspace/db";
import { eq, and, count, sql, desc, isNotNull } from "drizzle-orm";
import { normalizePhone } from "../lib/phone-normalize.js";

const router: IRouter = Router();

async function requireCampaign(campaignId: number, userId: string) {
  const [row] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
  return row ?? null;
}

// ── GET /campaigns/:id/batches/:batchId/analytics ────────────────────────────
router.get("/campaigns/:id/batches/:batchId/analytics", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const batchId    = parseInt(req.params["batchId"]!, 10);

  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const [batch] = await db.select().from(campaignBatchesTable)
    .where(and(eq(campaignBatchesTable.id, batchId), eq(campaignBatchesTable.campaignId, campaignId)));
  if (!batch) { res.status(404).json({ error: "Batch not found" }); return; }

  // Status breakdown
  const statusRows = await db
    .select({ status: campaignLeadsTable.callStatus, cnt: count() })
    .from(campaignLeadsTable)
    .where(and(
      eq(campaignLeadsTable.campaignId, campaignId),
      sql`${campaignLeadsTable.batchId} = ${batchId}`,
    ))
    .groupBy(campaignLeadsTable.callStatus);

  const statusMap: Record<string, number> = {};
  for (const r of statusRows) statusMap[r.status] = Number(r.cnt);

  // Disposition breakdown
  const dispRows = await db
    .select({ disposition: campaignLeadsTable.disposition, cnt: count() })
    .from(campaignLeadsTable)
    .where(and(
      eq(campaignLeadsTable.campaignId, campaignId),
      sql`${campaignLeadsTable.batchId} = ${batchId}`,
      isNotNull(campaignLeadsTable.disposition),
    ))
    .groupBy(campaignLeadsTable.disposition);

  const dispositions: Array<{ label: string; count: number }> = dispRows.map(r => ({
    label: r.disposition ?? "unknown",
    count: Number(r.cnt),
  }));

  // Callback count
  const [{ callbackCount }] = await db
    .select({ callbackCount: count() })
    .from(callCallbacksTable)
    .where(and(
      eq(callCallbacksTable.campaignId, campaignId),
      sql`EXISTS (SELECT 1 FROM campaign_leads cl WHERE cl.id = ${callCallbacksTable.leadId} AND cl.batch_id = ${batchId})`,
    ));

  // Retry count
  const [{ retryCount }] = await db
    .select({ retryCount: count() })
    .from(callRetriesTable)
    .where(and(
      eq(callRetriesTable.campaignId, campaignId),
      eq(callRetriesTable.status, "pending"),
      sql`EXISTS (SELECT 1 FROM campaign_leads cl WHERE cl.id = ${callRetriesTable.leadId} AND cl.batch_id = ${batchId})`,
    ));

  const total    = batch.totalLeads;
  const called   = statusMap["completed"] ?? 0;
  const failed   = (statusMap["failed"] ?? 0) + (statusMap["skipped"] ?? 0);
  const calling  = statusMap["calling"] ?? 0;
  const pending  = statusMap["pending"] ?? 0;
  const answered = called;
  const notPicked = failed;

  res.json({
    batchId,
    batchName:   batch.name,
    batchStatus: batch.status,
    stats: {
      total,
      called,
      pending,
      calling,
      failed,
      answered,
      notPicked,
      callbacks:   Number(callbackCount),
      pendingRetries: Number(retryCount),
      completionPct: total > 0 ? Math.round(((called + failed) / total) * 100) : 0,
    },
    statusBreakdown: statusMap,
    dispositions,
  });
});

// ── GET /campaigns/:id/analytics ─────────────────────────────────────────────
router.get("/campaigns/:id/analytics", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const dispRows = await db
    .select({ disposition: campaignLeadsTable.disposition, cnt: count() })
    .from(campaignLeadsTable)
    .where(and(
      eq(campaignLeadsTable.campaignId, campaignId),
      isNotNull(campaignLeadsTable.disposition),
    ))
    .groupBy(campaignLeadsTable.disposition);

  const dispositions: Array<{ label: string; count: number }> = dispRows.map(r => ({
    label: r.disposition ?? "unknown",
    count: Number(r.cnt),
  }));

  const statusRows = await db
    .select({ status: campaignLeadsTable.callStatus, cnt: count() })
    .from(campaignLeadsTable)
    .where(eq(campaignLeadsTable.campaignId, campaignId))
    .groupBy(campaignLeadsTable.callStatus);

  const statusMap: Record<string, number> = {};
  for (const r of statusRows) statusMap[r.status] = Number(r.cnt);

  const [{ callbackCount }] = await db
    .select({ callbackCount: count() })
    .from(callCallbacksTable)
    .where(eq(callCallbacksTable.campaignId, campaignId));

  res.json({
    campaignId,
    campaignName: campaign.name,
    dispositions,
    statusBreakdown: statusMap,
    callbacks: Number(callbackCount),
    totalLeads: campaign.totalLeads,
    calledLeads: campaign.calledLeads,
  });
});

// ── GET /campaigns/:id/csv-template ──────────────────────────────────────────
router.get("/campaigns/:id/csv-template", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const mappings = campaign.fieldMappings as Record<string, string>;
  const headers = Object.values(mappings).filter(Boolean);
  const uniqueHeaders = [...new Set(["phone", ...headers])];

  const csv = uniqueHeaders.join(",") + "\n";

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${campaign.name.replace(/[^a-z0-9]/gi, "_")}_template.csv"`);
  res.send(csv);
});

// ── GET /dnc ──────────────────────────────────────────────────────────────────
router.get("/dnc", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const rows = await db.select().from(workspaceDncTable)
    .where(and(eq(workspaceDncTable.userId, userId), eq(workspaceDncTable.isActive, true)))
    .orderBy(desc(workspaceDncTable.createdAt));

  res.json(rows.map(r => ({
    id:              r.id,
    phone:           r.phone,
    normalizedPhone: r.normalizedPhone,
    reason:          r.reason,
    createdAt:       r.createdAt.toISOString(),
  })));
});

// ── POST /dnc ─────────────────────────────────────────────────────────────────
router.post("/dnc", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const body = req.body as { phone?: string; reason?: string };
  if (!body.phone?.trim()) { res.status(400).json({ error: "phone required" }); return; }

  const normalized = normalizePhone(body.phone.trim());
  const [row] = await db.insert(workspaceDncTable)
    .values({ userId, phone: body.phone.trim(), normalizedPhone: normalized, reason: body.reason ?? null })
    .returning();

  res.status(201).json({
    id:              row!.id,
    phone:           row!.phone,
    normalizedPhone: row!.normalizedPhone,
    reason:          row!.reason,
    createdAt:       row!.createdAt.toISOString(),
  });
});

// ── DELETE /dnc/:id ───────────────────────────────────────────────────────────
router.delete("/dnc/:id", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params["id"]!, 10);
  const [deleted] = await db.update(workspaceDncTable)
    .set({ isActive: false })
    .where(and(eq(workspaceDncTable.id, id), eq(workspaceDncTable.userId, userId)))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).end();
});

export default router;

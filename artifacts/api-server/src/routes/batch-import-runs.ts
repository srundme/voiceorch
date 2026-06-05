/**
 * Batch Import Runs routes — Phase 1A
 * ─────────────────────────────────────────────────────────────────────────────
 * Read-only audit trail for CSV / Meta / Webhook imports into a batch.
 * Import runs are created by the import service; these routes expose the history.
 */

import { Router, type IRouter } from "express";
import { getAuth } from "../lib/auth-compat.js";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  campaignsTable,
  campaignBatchesTable,
  batchImportRunsTable,
} from "@workspace/db";

const router: IRouter = Router();

async function requireCampaign(campaignId: number, userId: string) {
  const [row] = await db.select({ id: campaignsTable.id })
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
  return row ?? null;
}

async function requireBatch(batchId: number, campaignId: number) {
  const [row] = await db.select({ id: campaignBatchesTable.id })
    .from(campaignBatchesTable)
    .where(and(eq(campaignBatchesTable.id, batchId), eq(campaignBatchesTable.campaignId, campaignId)));
  return row ?? null;
}

// GET /campaigns/:id/batches/:batchId/import-runs
router.get("/campaigns/:id/batches/:batchId/import-runs", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const batchId    = parseInt(req.params["batchId"]!, 10);

  if (!await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Campaign not found" }); return;
  }
  if (!await requireBatch(batchId, campaignId)) {
    res.status(404).json({ error: "Batch not found" }); return;
  }

  // Exclude errorReport from list view to keep payload small
  const runs = await db
    .select({
      id:               batchImportRunsTable.id,
      batchId:          batchImportRunsTable.batchId,
      sourceId:         batchImportRunsTable.sourceId,
      fileName:         batchImportRunsTable.fileName,
      status:           batchImportRunsTable.status,
      totalRows:        batchImportRunsTable.totalRows,
      validRows:        batchImportRunsTable.validRows,
      invalidRows:      batchImportRunsTable.invalidRows,
      duplicateRows:    batchImportRunsTable.duplicateRows,
      createdRows:      batchImportRunsTable.createdRows,
      processingTimeMs: batchImportRunsTable.processingTimeMs,
      createdAt:        batchImportRunsTable.createdAt,
    })
    .from(batchImportRunsTable)
    .where(eq(batchImportRunsTable.batchId, batchId))
    .orderBy(desc(batchImportRunsTable.createdAt));

  res.json(runs);
});

// GET /campaigns/:id/batches/:batchId/import-runs/:runId
router.get("/campaigns/:id/batches/:batchId/import-runs/:runId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const batchId    = parseInt(req.params["batchId"]!, 10);
  const runId      = parseInt(req.params["runId"]!, 10);

  if (!await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Campaign not found" }); return;
  }

  const [run] = await db.select().from(batchImportRunsTable)
    .where(and(
      eq(batchImportRunsTable.id, runId),
      eq(batchImportRunsTable.batchId, batchId),
    ));

  if (!run) { res.status(404).json({ error: "Import run not found" }); return; }
  res.json(run);
});

export default router;

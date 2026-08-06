/**
 * Campaign Ops routes — Phase 1A
 * ─────────────────────────────────────────────────────────────────────────────
 * CRUD for: lead sources, lead transfers, lead notes, lead tasks, lead tags.
 * All routes require campaign ownership verification.
 */

import { Router, type IRouter } from "express";
import { getAuth } from "../lib/auth-compat.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext } from "../middlewares/clientContext.js";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  campaignsTable,
  campaignLeadsTable,
  leadSourcesTable,
  leadTransfersTable,
  leadNotesTable,
  leadTasksTable,
  leadTagsTable,
} from "@workspace/db";
import { appendTimeline } from "../services/operational-outcome.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.use(requireAuth, clientContext);

// ── helpers ──────────────────────────────────────────────────────────────────

async function requireCampaign(campaignId: number, userId: string) {
  const [row] = await db.select({ id: campaignsTable.id })
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
  return row ?? null;
}

async function requireLead(leadId: number, campaignId: number) {
  const [row] = await db.select({ id: campaignLeadsTable.id })
    .from(campaignLeadsTable)
    .where(and(eq(campaignLeadsTable.id, leadId), eq(campaignLeadsTable.campaignId, campaignId)));
  return row ?? null;
}

// ── Lead Sources (workspace-level, reusable across campaigns) ─────────────────

// GET /lead-sources — list all sources owned by this user
router.get("/lead-sources", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const sources = await db.select().from(leadSourcesTable)
    .where(eq(leadSourcesTable.userId, userId))
    .orderBy(desc(leadSourcesTable.createdAt));
  res.json(sources);
});

// POST /lead-sources — create a workspace-level source
router.post("/lead-sources", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { campaignId, sourceType, sourceName, metaFormId, webhookId, fieldMapping } = req.body as {
    campaignId?: number;
    sourceType: string;
    sourceName: string;
    metaFormId?: string;
    webhookId?: number;
    fieldMapping?: Record<string, string>;
  };

  if (!sourceType || !sourceName) {
    res.status(400).json({ error: "sourceType and sourceName are required" });
    return;
  }

  // If campaignId provided, verify ownership (informational context, not exclusive ownership)
  if (campaignId) {
    const campaign = await requireCampaign(campaignId, userId);
    if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  }

  const [source] = await db.insert(leadSourcesTable).values({
    userId,
    campaignId: campaignId ?? null,
    sourceType,
    sourceName,
    metaFormId: metaFormId ?? null,
    webhookId: webhookId ?? null,
    fieldMapping: fieldMapping ?? {},
  }).returning();

  res.status(201).json(source);
});

// PATCH /lead-sources/:sourceId — update name or field mapping
router.patch("/lead-sources/:sourceId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const sourceId = parseInt(req.params["sourceId"]!, 10);

  const { sourceName, fieldMapping } = req.body as {
    sourceName?: string;
    fieldMapping?: Record<string, string> | null;
  };

  const updates: Partial<typeof leadSourcesTable.$inferInsert> = {};
  if (sourceName !== undefined) updates.sourceName = sourceName.trim();
  if (fieldMapping !== undefined) updates.fieldMapping = fieldMapping ?? {};

  const [updated] = await db.update(leadSourcesTable)
    .set(updates)
    .where(and(eq(leadSourcesTable.id, sourceId), eq(leadSourcesTable.userId, userId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Lead source not found" }); return; }
  res.json(updated);
});

// DELETE /lead-sources/:sourceId
router.delete("/lead-sources/:sourceId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const sourceId = parseInt(req.params["sourceId"]!, 10);

  const [deleted] = await db.delete(leadSourcesTable)
    .where(and(eq(leadSourcesTable.id, sourceId), eq(leadSourcesTable.userId, userId)))
    .returning({ id: leadSourcesTable.id });

  if (!deleted) { res.status(404).json({ error: "Lead source not found" }); return; }
  res.status(204).end();
});

// ── Lead Transfers ────────────────────────────────────────────────────────────

// GET /campaigns/:id/leads/:leadId/transfers
router.get("/campaigns/:id/leads/:leadId/transfers", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const campaignId = parseInt(req.params["id"]!, 10);
  const leadId     = parseInt(req.params["leadId"]!, 10);
  if (!await requireCampaign(campaignId, userId)) { res.status(404).json({ error: "Campaign not found" }); return; }
  if (!await requireLead(leadId, campaignId)) { res.status(404).json({ error: "Lead not found" }); return; }

  const transfers = await db.select().from(leadTransfersTable)
    .where(eq(leadTransfersTable.leadId, leadId))
    .orderBy(desc(leadTransfersTable.transferTime));
  res.json(transfers);
});

// POST /campaigns/:id/leads/:leadId/transfers
router.post("/campaigns/:id/leads/:leadId/transfers", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const campaignId = parseInt(req.params["id"]!, 10);
  const leadId     = parseInt(req.params["leadId"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  const lead = await requireLead(leadId, campaignId);
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const { transferredTo, callExecutionId, outcome, durationSeconds } = req.body as {
    transferredTo: string;
    callExecutionId?: number;
    outcome?: string;
    durationSeconds?: number;
  };
  if (!transferredTo) { res.status(400).json({ error: "transferredTo is required" }); return; }

  const [transfer] = await db.insert(leadTransfersTable).values({
    leadId,
    campaignId,
    callExecutionId: callExecutionId ?? null,
    transferredTo,
    outcome: outcome ?? null,
    durationSeconds: durationSeconds ?? null,
  }).returning();

  await appendTimeline(db, leadId, campaignId, "transfer_triggered", {
    transferId: transfer.id,
    transferredTo,
  });

  res.status(201).json(transfer);
});

// PATCH /campaigns/:id/leads/:leadId/transfers/:transferId
router.patch("/campaigns/:id/leads/:leadId/transfers/:transferId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const campaignId  = parseInt(req.params["id"]!, 10);
  const leadId      = parseInt(req.params["leadId"]!, 10);
  const transferId  = parseInt(req.params["transferId"]!, 10);
  if (!await requireCampaign(campaignId, userId)) { res.status(404).json({ error: "Campaign not found" }); return; }

  const { outcome, durationSeconds } = req.body as { outcome?: string; durationSeconds?: number };

  const updates: Partial<typeof leadTransfersTable.$inferInsert> = {};
  if (outcome !== undefined) updates.outcome = outcome;
  if (durationSeconds !== undefined) updates.durationSeconds = durationSeconds;

  const [updated] = await db.update(leadTransfersTable)
    .set(updates)
    .where(and(eq(leadTransfersTable.id, transferId), eq(leadTransfersTable.leadId, leadId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Transfer not found" }); return; }

  if (outcome === "completed") {
    await appendTimeline(db, leadId, campaignId, "transfer_completed", { transferId, outcome });
  }

  res.json(updated);
});

// ── Lead Notes ────────────────────────────────────────────────────────────────

// GET /campaigns/:id/leads/:leadId/notes
router.get("/campaigns/:id/leads/:leadId/notes", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const campaignId = parseInt(req.params["id"]!, 10);
  const leadId     = parseInt(req.params["leadId"]!, 10);
  if (!await requireCampaign(campaignId, userId)) { res.status(404).json({ error: "Campaign not found" }); return; }
  if (!await requireLead(leadId, campaignId)) { res.status(404).json({ error: "Lead not found" }); return; }

  const notes = await db.select().from(leadNotesTable)
    .where(eq(leadNotesTable.leadId, leadId))
    .orderBy(desc(leadNotesTable.createdAt));
  res.json(notes);
});

// POST /campaigns/:id/leads/:leadId/notes
router.post("/campaigns/:id/leads/:leadId/notes", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const campaignId = parseInt(req.params["id"]!, 10);
  const leadId     = parseInt(req.params["leadId"]!, 10);
  if (!await requireCampaign(campaignId, userId)) { res.status(404).json({ error: "Campaign not found" }); return; }
  if (!await requireLead(leadId, campaignId)) { res.status(404).json({ error: "Lead not found" }); return; }

  const { body } = req.body as { body: string };
  if (!body?.trim()) { res.status(400).json({ error: "body is required" }); return; }

  const [note] = await db.insert(leadNotesTable).values({
    leadId,
    campaignId,
    body: body.trim(),
    createdBy: userId,
  }).returning();

  await appendTimeline(db, leadId, campaignId, "note_added", { noteId: note.id });
  res.status(201).json(note);
});

// DELETE /campaigns/:id/leads/:leadId/notes/:noteId
router.delete("/campaigns/:id/leads/:leadId/notes/:noteId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const campaignId = parseInt(req.params["id"]!, 10);
  const noteId     = parseInt(req.params["noteId"]!, 10);
  if (!await requireCampaign(campaignId, userId)) { res.status(404).json({ error: "Campaign not found" }); return; }

  const [deleted] = await db.delete(leadNotesTable)
    .where(and(eq(leadNotesTable.id, noteId), eq(leadNotesTable.campaignId, campaignId)))
    .returning({ id: leadNotesTable.id });
  if (!deleted) { res.status(404).json({ error: "Note not found" }); return; }

  res.status(204).end();
});

// ── Lead Tasks ────────────────────────────────────────────────────────────────

// GET /campaigns/:id/leads/:leadId/tasks
router.get("/campaigns/:id/leads/:leadId/tasks", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const campaignId = parseInt(req.params["id"]!, 10);
  const leadId     = parseInt(req.params["leadId"]!, 10);
  if (!await requireCampaign(campaignId, userId)) { res.status(404).json({ error: "Campaign not found" }); return; }
  if (!await requireLead(leadId, campaignId)) { res.status(404).json({ error: "Lead not found" }); return; }

  const tasks = await db.select().from(leadTasksTable)
    .where(eq(leadTasksTable.leadId, leadId))
    .orderBy(leadTasksTable.dueAt, desc(leadTasksTable.createdAt));
  res.json(tasks);
});

// POST /campaigns/:id/leads/:leadId/tasks
router.post("/campaigns/:id/leads/:leadId/tasks", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const campaignId = parseInt(req.params["id"]!, 10);
  const leadId     = parseInt(req.params["leadId"]!, 10);
  if (!await requireCampaign(campaignId, userId)) { res.status(404).json({ error: "Campaign not found" }); return; }
  if (!await requireLead(leadId, campaignId)) { res.status(404).json({ error: "Lead not found" }); return; }

  const { title, dueAt, assignedToId, assignedToType } = req.body as {
    title: string;
    dueAt?: string;
    assignedToId?: string;
    assignedToType?: string;
  };
  if (!title?.trim()) { res.status(400).json({ error: "title is required" }); return; }

  const [task] = await db.insert(leadTasksTable).values({
    leadId,
    campaignId,
    title: title.trim(),
    dueAt: dueAt ? new Date(dueAt) : null,
    assignedToId: assignedToId ?? null,
    assignedToType: assignedToType ?? "user",
    status: "open",
  }).returning();

  await appendTimeline(db, leadId, campaignId, "task_created", { taskId: task.id, title });
  res.status(201).json(task);
});

// PATCH /campaigns/:id/leads/:leadId/tasks/:taskId
router.patch("/campaigns/:id/leads/:leadId/tasks/:taskId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const campaignId = parseInt(req.params["id"]!, 10);
  const leadId     = parseInt(req.params["leadId"]!, 10);
  const taskId     = parseInt(req.params["taskId"]!, 10);
  if (!await requireCampaign(campaignId, userId)) { res.status(404).json({ error: "Campaign not found" }); return; }

  const { title, dueAt, status, assignedToId } = req.body as {
    title?: string;
    dueAt?: string | null;
    status?: "open" | "done";
    assignedToId?: string | null;
  };

  const updates: Partial<typeof leadTasksTable.$inferInsert> = {};
  if (title !== undefined) updates.title = title.trim();
  if (dueAt !== undefined) updates.dueAt = dueAt ? new Date(dueAt) : null;
  if (status !== undefined) updates.status = status;
  if (assignedToId !== undefined) updates.assignedToId = assignedToId;
  if (status === "done") updates.completedAt = new Date();

  const [updated] = await db.update(leadTasksTable)
    .set(updates)
    .where(and(eq(leadTasksTable.id, taskId), eq(leadTasksTable.leadId, leadId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Task not found" }); return; }

  if (status === "done") {
    await appendTimeline(db, leadId, campaignId, "task_completed", { taskId });
  }

  res.json(updated);
});

// DELETE /campaigns/:id/leads/:leadId/tasks/:taskId
router.delete("/campaigns/:id/leads/:leadId/tasks/:taskId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const campaignId = parseInt(req.params["id"]!, 10);
  const taskId     = parseInt(req.params["taskId"]!, 10);
  if (!await requireCampaign(campaignId, userId)) { res.status(404).json({ error: "Campaign not found" }); return; }

  const [deleted] = await db.delete(leadTasksTable)
    .where(and(eq(leadTasksTable.id, taskId), eq(leadTasksTable.campaignId, campaignId)))
    .returning({ id: leadTasksTable.id });
  if (!deleted) { res.status(404).json({ error: "Task not found" }); return; }
  res.status(204).end();
});

// ── Lead Tags ─────────────────────────────────────────────────────────────────

// GET /campaigns/:id/leads/:leadId/tags
router.get("/campaigns/:id/leads/:leadId/tags", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const campaignId = parseInt(req.params["id"]!, 10);
  const leadId     = parseInt(req.params["leadId"]!, 10);
  if (!await requireCampaign(campaignId, userId)) { res.status(404).json({ error: "Campaign not found" }); return; }
  if (!await requireLead(leadId, campaignId)) { res.status(404).json({ error: "Lead not found" }); return; }

  const tags = await db.select().from(leadTagsTable)
    .where(eq(leadTagsTable.leadId, leadId))
    .orderBy(leadTagsTable.createdAt);
  res.json(tags);
});

// POST /campaigns/:id/leads/:leadId/tags
router.post("/campaigns/:id/leads/:leadId/tags", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const campaignId = parseInt(req.params["id"]!, 10);
  const leadId     = parseInt(req.params["leadId"]!, 10);
  if (!await requireCampaign(campaignId, userId)) { res.status(404).json({ error: "Campaign not found" }); return; }
  if (!await requireLead(leadId, campaignId)) { res.status(404).json({ error: "Lead not found" }); return; }

  const { tag } = req.body as { tag: string };
  if (!tag?.trim()) { res.status(400).json({ error: "tag is required" }); return; }

  const [newTag] = await db.insert(leadTagsTable).values({
    leadId,
    campaignId,
    tag: tag.trim().toLowerCase(),
  }).returning();

  await appendTimeline(db, leadId, campaignId, "tag_added", { tag: tag.trim() });
  res.status(201).json(newTag);
});

// DELETE /campaigns/:id/leads/:leadId/tags/:tagId
router.delete("/campaigns/:id/leads/:leadId/tags/:tagId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const campaignId = parseInt(req.params["id"]!, 10);
  const leadId     = parseInt(req.params["leadId"]!, 10);
  const tagId      = parseInt(req.params["tagId"]!, 10);
  if (!await requireCampaign(campaignId, userId)) { res.status(404).json({ error: "Campaign not found" }); return; }

  const [deleted] = await db.delete(leadTagsTable)
    .where(and(
      eq(leadTagsTable.id, tagId),
      eq(leadTagsTable.leadId, leadId),
      eq(leadTagsTable.campaignId, campaignId),
    ))
    .returning({ id: leadTagsTable.id, tag: leadTagsTable.tag });

  if (!deleted) { res.status(404).json({ error: "Tag not found" }); return; }
  await appendTimeline(db, leadId, campaignId, "tag_removed", { tag: deleted.tag });
  res.status(204).end();
});

export default router;

/**
 * Lead Workspace — Phase 5
 * ─────────────────────────────────────────────────────────────────────────────
 * One consolidated GET + targeted CRUD for the Lead CRM.
 * The workspace endpoint replaces per-section fetches with a single efficient load.
 */

import { Router, type IRouter } from "express";
import { getAuth } from "../lib/auth-compat.js";
import {
  db,
  campaignsTable, campaignBatchesTable, campaignLeadsTable,
  callExecutionsTable, callsTable, callCallbacksTable, callRetriesTable,
  callBookingsTable, leadTransfersTable, leadNotesTable,
  leadTasksTable, leadTagsTable, leadTimelineTable,
  leadInteractionSummaryTable, leadSourcesTable, batchImportRunsTable,
  agentsTable,
} from "@workspace/db";
import { eq, and, desc, inArray, sql } from "drizzle-orm";

const router: IRouter = Router();

async function requireCampaign(campaignId: number, userId: string) {
  const [row] = await db.select({ id: campaignsTable.id, name: campaignsTable.name, agentId: campaignsTable.agentId, fromNumber: campaignsTable.fromNumber })
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
  return row ?? null;
}

async function requireLead(leadId: number, campaignId: number) {
  const [row] = await db.select().from(campaignLeadsTable)
    .where(eq(campaignLeadsTable.id, leadId));
  if (!row) return null;

  // Fast path: campaignId is set — verify it matches the requested campaign.
  if (row.campaignId !== null) {
    return row.campaignId === campaignId ? row : null;
  }

  // Fallback for leads where campaignId was not written at import time:
  // verify ownership via the batchId → campaign_batches chain.
  if (row.batchId !== null) {
    const [batch] = await db.select({ campaignId: campaignBatchesTable.campaignId })
      .from(campaignBatchesTable)
      .where(eq(campaignBatchesTable.id, row.batchId));
    return (batch?.campaignId === campaignId) ? row : null;
  }

  // Neither campaignId nor batchId — cannot verify ownership.
  return null;
}

// ── GET /campaigns/:id/leads/:leadId/workspace ────────────────────────────────

router.get("/campaigns/:id/leads/:leadId/workspace", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!,      10);
  const leadId     = parseInt(req.params["leadId"]!, 10);

  const [campaign, lead] = await Promise.all([
    requireCampaign(campaignId, userId),
    requireLead(leadId, campaignId),
  ]);
  if (!campaign || !lead) { res.status(404).json({ error: "Not found" }); return; }

  // Agent name
  const agentNameP = campaign.agentId
    ? db.select({ name: agentsTable.name }).from(agentsTable).where(eq(agentsTable.id, campaign.agentId)).then(r => r[0]?.name ?? null)
    : Promise.resolve(null);

  // Batch
  const batchP = lead.batchId
    ? db.select({ id: campaignBatchesTable.id, name: campaignBatchesTable.name, status: campaignBatchesTable.status })
        .from(campaignBatchesTable).where(eq(campaignBatchesTable.id, lead.batchId)).then(r => r[0] ?? null)
    : Promise.resolve(null);

  // Source (via batch import run)
  const sourceP = lead.batchId
    ? db.select({ sourceName: leadSourcesTable.sourceName, sourceType: leadSourcesTable.sourceType })
        .from(batchImportRunsTable)
        .leftJoin(leadSourcesTable, eq(batchImportRunsTable.sourceId, leadSourcesTable.id))
        .where(eq(batchImportRunsTable.batchId, lead.batchId!))
        .orderBy(batchImportRunsTable.createdAt)
        .limit(1)
        .then(r => r[0] ?? null)
    : Promise.resolve(null);

  // Call executions + calls
  const executionsP = db.select().from(callExecutionsTable)
    .where(eq(callExecutionsTable.leadId, leadId))
    .orderBy(desc(callExecutionsTable.createdAt));

  // Callbacks
  const callbacksP = db.select().from(callCallbacksTable)
    .where(eq(callCallbacksTable.leadId, leadId))
    .orderBy(desc(callCallbacksTable.createdAt));

  // Pending retries
  const retriesP = db.select().from(callRetriesTable)
    .where(and(eq(callRetriesTable.leadId, leadId), eq(callRetriesTable.status, "pending")))
    .orderBy(callRetriesTable.scheduledAt);

  // Bookings
  const bookingsP = db.select().from(callBookingsTable)
    .where(eq(callBookingsTable.leadId, leadId))
    .orderBy(desc(callBookingsTable.createdAt));

  // Transfers (lead-level, canonical CRM record)
  const transfersP = db.select().from(leadTransfersTable)
    .where(eq(leadTransfersTable.leadId, leadId))
    .orderBy(desc(leadTransfersTable.createdAt));

  // Tags
  const tagsP = db.select().from(leadTagsTable)
    .where(eq(leadTagsTable.leadId, leadId))
    .orderBy(leadTagsTable.createdAt);

  // Notes
  const notesP = db.select().from(leadNotesTable)
    .where(eq(leadNotesTable.leadId, leadId))
    .orderBy(desc(leadNotesTable.createdAt));

  // Tasks
  const tasksP = db.select().from(leadTasksTable)
    .where(eq(leadTasksTable.leadId, leadId))
    .orderBy(desc(leadTasksTable.createdAt));

  // Cached interaction summary
  const summaryP = db.select().from(leadInteractionSummaryTable)
    .where(eq(leadInteractionSummaryTable.leadId, leadId))
    .then(r => r[0] ?? null);

  const [agentName, batch, source, executions, callbacks, retries,
         bookings, transfers, tags, notes, tasks, cachedSummary] =
    await Promise.all([
      agentNameP, batchP, sourceP, executionsP, callbacksP, retriesP,
      bookingsP, transfersP, tagsP, notesP, tasksP, summaryP,
    ]);

  // Enrich executions with call data
  const callIds = executions.filter(e => e.callId).map(e => e.callId!);
  const callsMap = new Map<number, typeof callsTable.$inferSelect>();
  if (callIds.length > 0) {
    const calls = await db.select().from(callsTable).where(inArray(callsTable.id, callIds));
    for (const c of calls) callsMap.set(c.id, c);
  }

  // Derive interaction summary live if no cache
  const latestExecWithAI = executions.find(e => e.callSummary || e.sentiment || e.detectedIntent);
  const interactionSummary = cachedSummary ? {
    latestSummary:   cachedSummary.latestSummary,
    latestSentiment: cachedSummary.latestSentiment,
    latestIntent:    cachedSummary.latestIntent,
    latestTopics:    cachedSummary.latestTopics,
    interactionCount: cachedSummary.interactionCount,
    lastContactAt:   cachedSummary.lastContactAt?.toISOString() ?? null,
  } : latestExecWithAI ? {
    latestSummary:   latestExecWithAI.callSummary ?? null,
    latestSentiment: latestExecWithAI.sentiment ?? null,
    latestIntent:    latestExecWithAI.detectedIntent ?? null,
    latestTopics:    latestExecWithAI.keyTopics ?? [],
    interactionCount: executions.length,
    lastContactAt:   executions[0]?.createdAt?.toISOString() ?? null,
  } : null;

  res.json({
    lead: {
      id:                 lead.id,
      campaignId:         lead.campaignId,
      batchId:            lead.batchId,
      phone:              lead.phone,
      normalizedPhone:    lead.normalizedPhone,
      name:               lead.name,
      email:              lead.email,
      leadData:           lead.leadData,
      callStatus:         lead.callStatus,
      callAttempts:       lead.callAttempts,
      disposition:        lead.disposition,
      operationalOutcome: lead.operationalOutcome,
      leadScore:          lead.leadScore,
      source:             lead.source,
      notes:              lead.notes,
      lastAttemptAt:      lead.lastAttemptAt?.toISOString() ?? null,
      createdAt:          lead.createdAt.toISOString(),
    },
    campaign: {
      id:         campaignId,
      name:       campaign.name,
      agentName,
      fromNumber: campaign.fromNumber,
    },
    batch:  batch  ? { id: batch.id,  name: batch.name,  status: batch.status }      : null,
    source: source ? { name: source.sourceName ?? lead.source, type: source.sourceType } : null,
    executions: executions.map(e => ({
      id:             e.id,
      callId:         e.callId,
      attemptNumber:  e.attemptNumber,
      outcome:        e.outcome,
      callSummary:    e.callSummary,
      sentiment:      e.sentiment,
      detectedIntent: e.detectedIntent,
      keyTopics:      e.keyTopics ?? [],
      createdAt:      e.createdAt.toISOString(),
      call:           e.callId ? (callsMap.get(e.callId) ?? null) : null,
    })),
    callbacks: callbacks.map(c => ({
      id:          c.id,
      status:      c.status,
      reason:      c.reason,
      rawExtract:  c.rawExtract,
      callbackAt:  c.callbackAt?.toISOString() ?? null,
      createdAt:   c.createdAt.toISOString(),
    })),
    pendingRetries: retries.map(r => ({
      id:            r.id,
      attemptNumber: r.attemptNumber,
      scheduledAt:   r.scheduledAt.toISOString(),
      reason:        r.reason,
      status:        r.status,
    })),
    bookings: bookings.map(b => ({
      id:            b.id,
      meetingTime:   b.meetingTime?.toISOString() ?? null,
      meetingStatus: b.meetingStatus,
      meetingLink:   b.meetingLink,
      bookingSource: b.bookingSource,
      bookedBy:      b.bookedBy,
      createdAt:     b.createdAt.toISOString(),
    })),
    transfers: transfers.map(t => ({
      id:              t.id,
      transferredTo:   t.transferredTo,
      outcome:         t.outcome,
      durationSeconds: t.durationSeconds,
      transferTime:    t.transferTime?.toISOString() ?? null,
    })),
    tags:  tags.map(t  => ({ id: t.id, tag: t.tag, createdAt: t.createdAt.toISOString() })),
    notes: notes.map(n => ({ id: n.id, body: n.body, createdBy: n.createdBy, createdAt: n.createdAt.toISOString() })),
    tasks: tasks.map(t => ({
      id:           t.id,
      title:        t.title,
      dueAt:        t.dueAt?.toISOString() ?? null,
      status:       t.status,
      assignedToId: t.assignedToId,
      createdAt:    t.createdAt.toISOString(),
      completedAt:  t.completedAt?.toISOString() ?? null,
    })),
    interactionSummary,
  });
});

// ── PATCH /campaigns/:id/leads/:leadId ────────────────────────────────────────

router.patch("/campaigns/:id/leads/:leadId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!,      10);
  const leadId     = parseInt(req.params["leadId"]!, 10);

  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const lead = await requireLead(leadId, campaignId);
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const { score, disposition } = req.body as {
    score?: number | null;
    disposition?: string | null;
  };

  const patch: Partial<typeof campaignLeadsTable.$inferInsert> = {};
  if (score       !== undefined) patch.leadScore  = score;
  if (disposition !== undefined) patch.disposition = disposition ?? undefined;

  if (Object.keys(patch).length === 0) { res.json({ ok: true }); return; }

  await db.update(campaignLeadsTable).set(patch).where(eq(campaignLeadsTable.id, leadId));

  // Timeline event
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  if (score !== undefined)       events.push({ type: "score_updated",   data: { score } });
  if (disposition !== undefined) events.push({ type: "disposition_set", data: { disposition } });
  if (events.length > 0) {
    await db.insert(leadTimelineTable).values(
      events.map(e => ({ leadId, campaignId, eventType: e.type, data: e.data }))
    );
  }

  res.json({ ok: true });
});

// ── Notes CRUD ────────────────────────────────────────────────────────────────

router.post("/campaigns/:id/leads/:leadId/notes", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!,      10);
  const leadId     = parseInt(req.params["leadId"]!, 10);

  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const { body } = req.body as { body?: string };
  if (!body?.trim()) { res.status(400).json({ error: "Note body required" }); return; }

  const [note] = await db.insert(leadNotesTable).values({
    leadId, campaignId, body: body.trim(), createdBy: userId,
  }).returning();

  await db.insert(leadTimelineTable).values({
    leadId, campaignId, eventType: "note_added", data: { noteId: note!.id, preview: body.trim().slice(0, 100) },
  });

  res.status(201).json({ note: { id: note!.id, body: note!.body, createdBy: note!.createdBy, createdAt: note!.createdAt.toISOString() } });
});

router.delete("/campaigns/:id/leads/:leadId/notes/:noteId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!,      10);
  const leadId     = parseInt(req.params["leadId"]!, 10);
  const noteId     = parseInt(req.params["noteId"]!,  10);

  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  await db.delete(leadNotesTable)
    .where(and(eq(leadNotesTable.id, noteId), eq(leadNotesTable.leadId, leadId)));

  res.json({ ok: true });
});

// ── Tasks CRUD ────────────────────────────────────────────────────────────────

router.post("/campaigns/:id/leads/:leadId/tasks", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!,      10);
  const leadId     = parseInt(req.params["leadId"]!, 10);

  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const { title, dueAt } = req.body as { title?: string; dueAt?: string };
  if (!title?.trim()) { res.status(400).json({ error: "Task title required" }); return; }

  const [task] = await db.insert(leadTasksTable).values({
    leadId, campaignId,
    title: title.trim(),
    dueAt: dueAt ? new Date(dueAt) : undefined,
    status: "open",
    assignedToId: userId,
    assignedToType: "user",
  }).returning();

  await db.insert(leadTimelineTable).values({
    leadId, campaignId, eventType: "task_created", data: { taskId: task!.id, title: title.trim() },
  });

  res.status(201).json({
    task: {
      id: task!.id, title: task!.title, dueAt: task!.dueAt?.toISOString() ?? null,
      status: task!.status, assignedToId: task!.assignedToId,
      createdAt: task!.createdAt.toISOString(), completedAt: null,
    },
  });
});

router.patch("/campaigns/:id/leads/:leadId/tasks/:taskId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!,      10);
  const leadId     = parseInt(req.params["leadId"]!, 10);
  const taskId     = parseInt(req.params["taskId"]!,  10);

  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const { status, title, dueAt } = req.body as { status?: string; title?: string; dueAt?: string };

  const patch: Partial<typeof leadTasksTable.$inferInsert> = {};
  if (title  !== undefined) patch.title = title;
  if (dueAt  !== undefined) patch.dueAt = dueAt ? new Date(dueAt) : undefined;
  if (status !== undefined) {
    patch.status = status;
    if (status === "done") patch.completedAt = new Date();
    if (status === "open") patch.completedAt = undefined;
  }

  await db.update(leadTasksTable).set(patch)
    .where(and(eq(leadTasksTable.id, taskId), eq(leadTasksTable.leadId, leadId)));

  if (status === "done") {
    await db.insert(leadTimelineTable).values({
      leadId, campaignId, eventType: "task_completed", data: { taskId },
    });
  }

  res.json({ ok: true });
});

router.delete("/campaigns/:id/leads/:leadId/tasks/:taskId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!,      10);
  const leadId     = parseInt(req.params["leadId"]!, 10);
  const taskId     = parseInt(req.params["taskId"]!,  10);

  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  await db.delete(leadTasksTable)
    .where(and(eq(leadTasksTable.id, taskId), eq(leadTasksTable.leadId, leadId)));

  res.json({ ok: true });
});

// ── Tags CRUD ─────────────────────────────────────────────────────────────────

router.post("/campaigns/:id/leads/:leadId/tags", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!,      10);
  const leadId     = parseInt(req.params["leadId"]!, 10);

  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const { tag } = req.body as { tag?: string };
  const normalizedTag = tag?.trim().toLowerCase();
  if (!normalizedTag) { res.status(400).json({ error: "Tag required" }); return; }

  const [existing] = await db.select().from(leadTagsTable)
    .where(and(eq(leadTagsTable.leadId, leadId), eq(leadTagsTable.tag, normalizedTag)));

  if (existing) { res.status(409).json({ error: "Tag already exists" }); return; }

  const [newTag] = await db.insert(leadTagsTable).values({
    leadId, campaignId, tag: normalizedTag,
  }).returning();

  await db.insert(leadTimelineTable).values({
    leadId, campaignId, eventType: "tag_added", data: { tag: normalizedTag },
  });

  res.status(201).json({ tag: { id: newTag!.id, tag: newTag!.tag, createdAt: newTag!.createdAt.toISOString() } });
});

router.delete("/campaigns/:id/leads/:leadId/tags/:tagId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!,      10);
  const leadId     = parseInt(req.params["leadId"]!, 10);
  const tagId      = parseInt(req.params["tagId"]!,   10);

  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const [removed] = await db.delete(leadTagsTable)
    .where(and(eq(leadTagsTable.id, tagId), eq(leadTagsTable.leadId, leadId)))
    .returning();

  if (removed) {
    await db.insert(leadTimelineTable).values({
      leadId, campaignId, eventType: "tag_removed", data: { tag: removed.tag },
    });
  }

  res.json({ ok: true });
});

// ── GET /campaigns/:id/leads/:leadId/timeline ─────────────────────────────────
// Full timeline endpoint (supplement to existing profile endpoint)

router.get("/campaigns/:id/leads/:leadId/timeline", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!,      10);
  const leadId     = parseInt(req.params["leadId"]!, 10);

  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const events = await db.select().from(leadTimelineTable)
    .where(eq(leadTimelineTable.leadId, leadId))
    .orderBy(desc(leadTimelineTable.createdAt))
    .limit(200);

  res.json(events.map(e => ({
    id: e.id, leadId: e.leadId, campaignId: e.campaignId,
    eventType: e.eventType, data: e.data,
    createdAt: e.createdAt.toISOString(),
  })));
});

export default router;

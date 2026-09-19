/**
 * Campaign Lead CRM routes
 * ─────────────────────────────────────────────────────────────────────────────
 * Lead profile, call execution history, timeline, and callbacks per lead.
 */

import { Router, type IRouter } from "express";
import { getAuth } from "../lib/auth-compat.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext } from "../middlewares/clientContext.js";
import {
  db, campaignsTable, campaignLeadsTable, callsTable,
  callExecutionsTable, leadTimelineTable, callCallbacksTable, callRetriesTable,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { scheduleCampaignCall } from "../orchestration/campaignCaller.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.use(requireAuth, clientContext);

async function requireCampaign(campaignId: number, userId: string) {
  const [row] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
  return row ?? null;
}

async function requireLead(leadId: number, campaignId: number) {
  const [row] = await db.select().from(campaignLeadsTable)
    .where(and(eq(campaignLeadsTable.id, leadId), eq(campaignLeadsTable.campaignId, campaignId)));
  return row ?? null;
}

// ── GET /campaigns/:id/leads/:leadId ─────────────────────────────────────────
router.get("/campaigns/:id/leads/:leadId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const leadId     = parseInt(req.params["leadId"]!, 10);

  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

  const lead = await requireLead(leadId, campaignId);
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  // Fetch all executions for this lead
  const executions = await db.select().from(callExecutionsTable)
    .where(eq(callExecutionsTable.leadId, leadId))
    .orderBy(desc(callExecutionsTable.createdAt));

  const callIds = executions.filter(e => e.callId).map(e => e.callId!);
  const callsMap = new Map<number, typeof callsTable.$inferSelect>();
  if (callIds.length > 0) {
    const calls = await db.select().from(callsTable).where(inArray(callsTable.id, callIds));
    for (const c of calls) callsMap.set(c.id, c);
  }

  // Also fetch the most recent call directly (for leads that predate call_executions)
  let latestCall = lead.callId ? callsMap.get(lead.callId) : undefined;
  if (!latestCall && lead.callId) {
    const [c] = await db.select().from(callsTable).where(eq(callsTable.id, lead.callId));
    latestCall = c;
  }

  // Callbacks
  const callbacks = await db.select().from(callCallbacksTable)
    .where(eq(callCallbacksTable.leadId, leadId))
    .orderBy(desc(callCallbacksTable.createdAt));

  // Pending retries
  const retries = await db.select().from(callRetriesTable)
    .where(and(eq(callRetriesTable.leadId, leadId), eq(callRetriesTable.status, "pending")))
    .orderBy(callRetriesTable.scheduledAt);

  res.json({
    lead: {
      id:             lead.id,
      campaignId:     lead.campaignId,
      batchId:        lead.batchId,
      phone:          lead.phone,
      normalizedPhone: lead.normalizedPhone,
      name:           lead.name,
      email:          lead.email,
      leadData:       lead.leadData,
      callStatus:     lead.callStatus,
      disposition:    lead.disposition,
      callAttempts:   lead.callAttempts,
      lastAttemptAt:  lead.lastAttemptAt?.toISOString() ?? null,
      source:         lead.source,
      notes:          lead.notes,
      createdAt:      lead.createdAt.toISOString(),
    },
    latestCall: latestCall ? serializeCall(latestCall) : null,
    executions: executions.map(e => ({
      id:            e.id,
      callId:        e.callId,
      attemptNumber: e.attemptNumber,
      outcome:       e.outcome,
      createdAt:     e.createdAt.toISOString(),
      call:          e.callId ? (callsMap.get(e.callId) ? serializeCall(callsMap.get(e.callId)!) : null) : null,
    })),
    callbacks: callbacks.map(c => ({
      id:         c.id,
      callId:     c.callId,
      callbackAt: c.callbackAt?.toISOString() ?? null,
      reason:     c.reason,
      rawExtract: c.rawExtract,
      status:     c.status,
      createdAt:  c.createdAt.toISOString(),
    })),
    pendingRetries: retries.map(r => ({
      id:            r.id,
      attemptNumber: r.attemptNumber,
      scheduledAt:   r.scheduledAt.toISOString(),
      reason:        r.reason,
    })),
    campaign: { id: campaign.id, name: campaign.name },
  });
});

// ── GET /campaigns/:id/leads/:leadId/timeline ─────────────────────────────────
router.get("/campaigns/:id/leads/:leadId/timeline", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const leadId     = parseInt(req.params["leadId"]!, 10);

  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

  const timeline = await db.select().from(leadTimelineTable)
    .where(eq(leadTimelineTable.leadId, leadId))
    .orderBy(desc(leadTimelineTable.createdAt));

  res.json(timeline.map(e => ({
    id:        e.id,
    eventType: e.eventType,
    data:      e.data,
    createdAt: e.createdAt.toISOString(),
  })));
});

// ── PATCH /campaigns/:id/leads/:leadId/callbacks/:callbackId ──────────────────
router.patch("/campaigns/:id/leads/:leadId/callbacks/:callbackId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId  = parseInt(req.params["id"]!, 10);
  const leadId      = parseInt(req.params["leadId"]!, 10);
  const callbackId  = parseInt(req.params["callbackId"]!, 10);

  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const body = req.body as { status?: string; callbackAt?: string };
  const [updated] = await db.update(callCallbacksTable)
    .set({
      ...(body.status    ? { status: body.status }                          : {}),
      ...(body.callbackAt ? { callbackAt: new Date(body.callbackAt) }       : {}),
    })
    .where(and(
      eq(callCallbacksTable.id, callbackId),
      eq(callCallbacksTable.leadId, leadId),
    ))
    .returning();

  if (!updated) { res.status(404).json({ error: "Callback not found" }); return; }
  res.json(updated);
});

// ── POST /campaigns/:id/leads/:leadId/retry ────────────────────────────────
router.post("/campaigns/:id/leads/:leadId/retry", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const leadId     = parseInt(req.params["leadId"]!, 10);

  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

  const lead = await requireLead(leadId, campaignId);
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const [updated] = await db.update(campaignLeadsTable)
    .set({ callStatus: "pending", notes: "Manual retry" })
    .where(eq(campaignLeadsTable.id, leadId))
    .returning();

  await db.insert(leadTimelineTable).values({
    leadId, campaignId, eventType: "manual_retry", data: {},
  });

  scheduleCampaignCall(updated!, campaign);
  logger.info({ leadId, campaignId }, "Manual retry queued");
  res.json({ queued: true });
});

router.post("/campaigns/:id/leads/:leadId/retries/cancel", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const leadId     = parseInt(req.params["leadId"]!, 10);

  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  const lead = await requireLead(leadId, campaignId);
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const cancelled = await db.update(callRetriesTable)
    .set({ status: "cancelled" })
    .where(and(eq(callRetriesTable.leadId, leadId), eq(callRetriesTable.status, "pending")))
    .returning({ id: callRetriesTable.id });

  res.json({ cancelled: cancelled.length });
});

function serializeCall(c: typeof callsTable.$inferSelect) {
  return {
    id:               c.id,
    status:           c.status,
    toNumber:         c.toNumber,
    fromNumber:       c.fromNumber,
    durationSeconds:  c.durationSeconds,
    transcript:       c.transcript,
    recordingUrl:     c.recordingUrl,
    callSummary:      c.callSummary,
    dispositionResult: c.dispositionResult,
    transferType:     c.transferType,
    transferTarget:   c.transferTarget,
    amdResult:        c.amdResult,
    successEvaluation: c.successEvaluation,
    sttLatencyMs:     c.sttLatencyMs,
    llmLatencyMs:     c.llmLatencyMs,
    ttsFirstChunkMs:  c.ttsFirstChunkMs,
    costCents:        c.costCents,
    createdAt:        c.createdAt.toISOString(),
    endedAt:          c.endedAt?.toISOString() ?? null,
  };
}

export default router;

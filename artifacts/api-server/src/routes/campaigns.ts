import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { randomUUID } from "crypto";
import {
  CreateCampaignBody,
  UpdateCampaignBody,
} from "@workspace/api-zod";
import { db, campaignsTable, campaignLeadsTable, callsTable, type CampaignFieldMappings } from "@workspace/db";
import { eq, and, count, desc, inArray } from "drizzle-orm";
import { scheduleCampaignCall } from "../orchestration/campaignCaller.js";

const router: IRouter = Router();

function toCampaign(row: typeof campaignsTable.$inferSelect) {
  return {
    id:                    row.id,
    name:                  row.name,
    description:           row.description,
    agentId:               row.agentId,
    status:                row.status,
    webhookToken:          row.webhookToken,
    fieldMappings:         row.fieldMappings,
    fromNumber:            row.fromNumber,
    callDelaySeconds:      row.callDelaySeconds,
    maxAttempts:           row.maxAttempts,
    retryDelayMinutes:     row.retryDelayMinutes,
    totalLeads:            row.totalLeads,
    calledLeads:           row.calledLeads,
    concurrentCallLimit: row.concurrentCallLimit,
    isActive:              row.isActive,
    createdAt:             row.createdAt.toISOString(),
    updatedAt:             row.updatedAt.toISOString(),
  };
}

function toLead(row: typeof campaignLeadsTable.$inferSelect) {
  return {
    id:             row.id,
    campaignId:     row.campaignId,
    phone:          row.phone,
    name:           row.name,
    email:          row.email,
    leadData:       row.leadData,
    callStatus:     row.callStatus,
    callId:         row.callId,
    callAttempts:   row.callAttempts,
    lastAttemptAt:  row.lastAttemptAt?.toISOString() ?? null,
    source:         row.source,
    externalLeadId: row.externalLeadId,
    notes:          row.notes,
    createdAt:      row.createdAt.toISOString(),
  };
}

function requireClerk(req: Parameters<Parameters<IRouter["get"]>[1]>[0]) {
  const { userId } = getAuth(req);
  if (!userId) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  return userId;
}

// ── GET /campaigns ─────────────────────────────────────────────────────────
router.get("/campaigns", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const rows = await db.select().from(campaignsTable)
    .where(eq(campaignsTable.userId, userId))
    .orderBy(desc(campaignsTable.createdAt));

  res.json(rows.map(toCampaign));
});

// ── POST /campaigns ────────────────────────────────────────────────────────
router.post("/campaigns", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = CreateCampaignBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  if (!parsed.data.fieldMappings["phone"]) {
    res.status(400).json({ error: "fieldMappings must include a 'phone' key" });
    return;
  }

  const [campaign] = await db.insert(campaignsTable).values({
    userId,
    name:              parsed.data.name,
    description:       parsed.data.description,
    agentId:           parsed.data.agentId,
    fieldMappings:     parsed.data.fieldMappings as CampaignFieldMappings,
    fromNumber:        parsed.data.fromNumber,
    callDelaySeconds:  parsed.data.callDelaySeconds,
    maxAttempts:       parsed.data.maxAttempts,
    retryDelayMinutes: parsed.data.retryDelayMinutes,
    webhookToken:      randomUUID(),
  }).returning();

  res.status(201).json(toCampaign(campaign!));
});

// ── GET /campaigns/:id ─────────────────────────────────────────────────────
router.get("/campaigns/:id", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params["id"]!, 10);
  const [row] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, userId)));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(toCampaign(row));
});

// ── PATCH /campaigns/:id ───────────────────────────────────────────────────
router.patch("/campaigns/:id", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params["id"]!, 10);
  const parsed = UpdateCampaignBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  // If toggling isActive, also sync status field
  const { fieldMappings: rawMappings, ...rest } = parsed.data;
  const updateData: Partial<typeof campaignsTable.$inferInsert> = { ...rest };
  if (rawMappings) updateData.fieldMappings = rawMappings as CampaignFieldMappings;
  if (parsed.data.isActive === true  && !parsed.data.status) updateData.status = "active";
  if (parsed.data.isActive === false && !parsed.data.status) updateData.status = "paused";

  const [row] = await db.update(campaignsTable)
    .set(updateData)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, userId)))
    .returning();

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(toCampaign(row));
});

// ── DELETE /campaigns/:id ──────────────────────────────────────────────────
router.delete("/campaigns/:id", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params["id"]!, 10);
  const deleted = await db.delete(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, userId)))
    .returning();

  if (!deleted.length) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).end();
});

// ── GET /campaigns/:id/leads ───────────────────────────────────────────────
router.get("/campaigns/:id/leads", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);

  // Verify ownership
  const [campaign] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const limitVal  = Math.min(parseInt(String(req.query["limit"]  ?? "50"), 10), 200);
  const offsetVal = parseInt(String(req.query["offset"] ?? "0"), 10);
  const statusFilter = req.query["status"] as string | undefined;

  const where = statusFilter
    ? and(eq(campaignLeadsTable.campaignId, campaignId), eq(campaignLeadsTable.callStatus, statusFilter))
    : eq(campaignLeadsTable.campaignId, campaignId);

  const [leads, [{ total }]] = await Promise.all([
    db.select().from(campaignLeadsTable)
      .where(where)
      .orderBy(desc(campaignLeadsTable.createdAt))
      .limit(limitVal)
      .offset(offsetVal),
    db.select({ total: count() }).from(campaignLeadsTable).where(where),
  ]);

  res.json({ leads: leads.map(toLead), total: Number(total) });
});

// ── POST /campaigns/:id/import-leads ──────────────────────────────────────
router.post("/campaigns/:id/import-leads", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);

  const [campaign] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const body = req.body as { leads?: unknown };
  if (!Array.isArray(body.leads)) {
    res.status(400).json({ error: "leads must be an array" });
    return;
  }

  const rawLeads = body.leads as Record<string, string>[];
  const mappings = campaign.fieldMappings as CampaignFieldMappings;
  const phoneField = mappings.phone ?? "phone";
  const nameField  = mappings.name  ?? "name";
  const emailField = mappings.email ?? "email";

  let imported = 0;
  let skipped  = 0;
  const errors: string[] = [];
  const toInsert: (typeof campaignLeadsTable.$inferInsert)[] = [];

  for (const row of rawLeads) {
    const phone = (row[phoneField] ?? row["phone"] ?? "").trim();
    if (!phone) {
      skipped++;
      if (errors.length < 20) errors.push(`Row skipped — missing phone column "${phoneField}"`);
      continue;
    }
    const name  = (row[nameField]  ?? row["name"]  ?? "").trim() || null;
    const email = (row[emailField] ?? row["email"] ?? "").trim() || null;
    const leadData: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) { if (v?.trim()) leadData[k] = v.trim(); }

    toInsert.push({ campaignId, phone, name, email, leadData, source: "csv" });
    imported++;
  }

  if (toInsert.length > 0) {
    for (let i = 0; i < toInsert.length; i += 100) {
      await db.insert(campaignLeadsTable).values(toInsert.slice(i, i + 100));
    }
    await db.update(campaignsTable)
      .set({ totalLeads: campaign.totalLeads + imported })
      .where(eq(campaignsTable.id, campaignId));
  }

  req.log.info({ campaignId, imported, skipped }, "CSV leads imported");
  res.json({ imported, skipped, errors });
});

// ── GET /campaigns/meta-leads ──────────────────────────────────────────────
// Must be registered BEFORE /campaigns/:id to avoid "meta-leads" matching as id
router.get("/campaigns/meta-leads", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const limitVal  = Math.min(parseInt(String(req.query["limit"]  ?? "50"), 10), 200);
  const offsetVal = parseInt(String(req.query["offset"] ?? "0"), 10);
  const filter    = String(req.query["filter"] ?? "all");

  // Get all campaigns for this user
  const campaigns = await db.select().from(campaignsTable).where(eq(campaignsTable.userId, userId));
  if (!campaigns.length) { res.json({ leads: [], total: 0 }); return; }

  const campaignIds = campaigns.map(c => c.id);
  const campaignMap = new Map(campaigns.map(c => [c.id, c]));

  // Base: non-CSV leads (webhook + instagram_ads sources) across all user campaigns
  let whereClause = and(
    inArray(campaignLeadsTable.campaignId, campaignIds),
    inArray(campaignLeadsTable.source, ["webhook", "instagram_ads"]),
  );

  if (filter === "no_pickup") {
    whereClause = and(whereClause, inArray(campaignLeadsTable.callStatus, ["failed", "skipped"]));
  } else if (filter === "inbound") {
    // Inbound calls not tracked yet — return empty
    res.json({ leads: [], total: 0 }); return;
  } else if (filter !== "all" && filter !== "callbacks") {
    // Dynamic disposition filter
    whereClause = and(whereClause, eq(campaignLeadsTable.disposition, filter));
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
    const call     = lead.callId ? callsMap.get(lead.callId) : undefined;
    const campaign = campaignMap.get(lead.campaignId);
    return {
      id:              lead.id,
      campaignId:      lead.campaignId,
      campaignName:    campaign?.name ?? "",
      batchId:         lead.batchId ?? null,
      batchName:       null as string | null,
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

// ── POST /campaigns/:id/redial ─────────────────────────────────────────────
router.post("/campaigns/:id/redial", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const [campaign] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const noPickup = await db.select().from(campaignLeadsTable)
    .where(and(
      eq(campaignLeadsTable.campaignId, campaignId),
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

// ── POST /campaigns/:id/leads/:leadId/retry ────────────────────────────────
router.post("/campaigns/:id/leads/:leadId/retry", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const leadId     = parseInt(req.params["leadId"]!, 10);

  const [campaign] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

  const [lead] = await db.select().from(campaignLeadsTable)
    .where(and(eq(campaignLeadsTable.id, leadId), eq(campaignLeadsTable.campaignId, campaignId)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  // Reset to pending, then fire
  const [updated] = await db.update(campaignLeadsTable)
    .set({ callStatus: "pending", notes: null })
    .where(eq(campaignLeadsTable.id, leadId))
    .returning();

  scheduleCampaignCall(updated!, campaign);
  res.json(toLead(updated!));
});

export default router;

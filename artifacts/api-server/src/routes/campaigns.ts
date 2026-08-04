import { Router, type IRouter } from "express";
import { getAuth } from "../lib/auth-compat.js";
import { randomUUID } from "crypto";
import {
  CreateCampaignBody,
  UpdateCampaignBody,
} from "@workspace/api-zod";
import { db, campaignsTable, campaignLeadsTable, callsTable, agentsTable, providersTable, platformSettingsTable, campaignConsentBasisTable, phoneNumbersTable, type CampaignFieldMappings } from "@workspace/db";
import { encryptKey, decryptKey } from "../lib/crypto.js";
import { eq, and, count, desc, inArray, isNull, ne } from "drizzle-orm";
import { scheduleCampaignCall } from "../orchestration/campaignCaller.js";
import { evaluateIrdaiGate, IRDAI_BLOCKED_MESSAGE, IRDAI_BLOCKED_CODE, type IrdaiGateResult } from "../services/irdai/gate.js";

const router: IRouter = Router();

/**
 * Hard platform ceiling on how many concurrent calls a single campaign may run.
 * Enforced server-side on create/update regardless of the account's stored limit.
 */
const MAX_CONCURRENT_CALLS = 10;

/**
 * Evaluate the IRDAI enforcement gate for a campaign's assigned agent. Reads the
 * agent's latest stored irdaiComplianceStatus (no re-check at call time).
 * Returns a not-blocked result when the campaign has no agent assigned.
 */
async function evaluateCampaignIrdaiGate(agentId: number | null | undefined): Promise<IrdaiGateResult> {
  if (!agentId) return { blocked: false, missingItems: [] };
  const [row] = await db
    .select({ agentConfig: agentsTable.agentConfig })
    .from(agentsTable)
    .where(eq(agentsTable.id, agentId));
  return evaluateIrdaiGate(row?.agentConfig ?? null);
}

type ConsentBasisInput = {
  basisType: "existing_customer" | "service_callback" | "fresh_marketing_consent" | "other";
  attestedBy?: string;
  consentSource?: string;
  consentDateRange?: string;
  proofReference?: string;
  notes?: string;
};

/** True when the agent has DPDP compliance enabled in its config. */
async function isAgentDpdpEnabled(agentId: number | null | undefined): Promise<boolean> {
  if (!agentId) return false;
  const [row] = await db
    .select({ agentConfig: agentsTable.agentConfig })
    .from(agentsTable)
    .where(eq(agentsTable.id, agentId));
  return !!((row?.agentConfig as { compliance?: { dpdp?: boolean } } | null)?.compliance?.dpdp);
}

/**
 * Validate a DPDP consent basis payload. Returns an error string when invalid,
 * or null when valid. Record-keeping validation only — never blocks dialing.
 */
function validateConsentBasis(basis: ConsentBasisInput | undefined): string | null {
  if (!basis) return "A documented consent basis is required because the assigned agent has DPDP compliance enabled.";
  if (basis.basisType === "fresh_marketing_consent") {
    if (!basis.consentSource?.trim() || !basis.consentDateRange?.trim()) {
      return "Fresh marketing consent requires both a consent source and a consent date range.";
    }
  }
  if (basis.basisType === "other" && !basis.notes?.trim()) {
    return "Consent basis 'Other' requires notes describing the basis.";
  }
  return null;
}

function toConsentBasisRecord(row: typeof campaignConsentBasisTable.$inferSelect) {
  return {
    id:               row.id,
    campaignId:       row.campaignId,
    basisType:        row.basisType,
    attestedBy:       row.attestedBy,
    attestedAt:       row.attestedAt.toISOString(),
    consentSource:    row.consentSource,
    consentDateRange: row.consentDateRange,
    proofReference:   row.proofReference,
    notes:            row.notes,
  };
}

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
    concurrentCallLimit:   row.concurrentCallLimit,
    isActive:              row.isActive,
    leadSource:            row.leadSource ?? "csv",
    triggerMode:           row.triggerMode ?? "batch",
    businessHoursStart:    row.businessHoursStart ?? null,
    businessHoursEnd:      row.businessHoursEnd ?? null,
    isCallingHoursEnabled: row.isCallingHoursEnabled,
    timezone:              row.timezone ?? null,
    sourceFormId:              row.sourceFormId ?? null,
    sourcePageId:              row.sourcePageId ?? null,
    lastValidationError:       row.lastValidationError ?? null,
    lastWebhookAt:             row.lastWebhookAt?.toISOString() ?? null,
    lastWebhookStatus:         row.lastWebhookStatus ?? null,
    metaPageAccessTokenHint:   row.metaPageAccessToken
      ? (() => { try { const t = decryptKey(row.metaPageAccessToken!); return `…${t.slice(-6)}`; } catch { return "…(set)"; } })()
      : null,
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
    // Hide internal per-agent campaigns created by the workflow engine.
    .where(and(eq(campaignsTable.userId, userId), ne(campaignsTable.leadSource, "workflow")))
    .orderBy(desc(campaignsTable.createdAt));

  res.json(rows.map(toCampaign));
});

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

// ── GET /campaigns/export.csv ─────────────────────────────────────────────────
router.get("/campaigns/export.csv", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaigns = await db.select().from(campaignsTable)
    .where(eq(campaignsTable.userId, userId))
    .orderBy(desc(campaignsTable.createdAt));

  const agentIds = [...new Set(campaigns.filter(c => c.agentId != null).map(c => c.agentId!))];
  const agentsMap = new Map<number, string>();
  if (agentIds.length > 0) {
    const agents = await db.select({ id: agentsTable.id, name: agentsTable.name })
      .from(agentsTable).where(inArray(agentsTable.id, agentIds));
    for (const a of agents) agentsMap.set(a.id, a.name);
  }

  const headers = [
    "Campaign Name", "Status", "Agent", "From Number", "Lead Source",
    "Total Leads", "Called Leads", "Progress %", "Connected", "Booked",
    "Transferred", "Callbacks", "Failed", "Success Rate %", "Total Cost ($)",
    "Created Date",
  ];

  const rows = await Promise.all(campaigns.map(async campaign => {
    const leads = await db.select({
      callStatus:         campaignLeadsTable.callStatus,
      operationalOutcome: campaignLeadsTable.operationalOutcome,
      callId:             campaignLeadsTable.callId,
    }).from(campaignLeadsTable).where(eq(campaignLeadsTable.campaignId, campaign.id));

    const connected   = leads.filter(l => l.callStatus === "completed").length;
    const booked      = leads.filter(l => l.operationalOutcome === "booking_created").length;
    const transferred = leads.filter(l => l.operationalOutcome === "transfer_completed").length;
    const callbacks   = leads.filter(l => l.operationalOutcome === "callback_requested").length;
    const failed      = leads.filter(l => l.callStatus === "failed").length;
    const progressPct = campaign.totalLeads > 0 ? Math.round((campaign.calledLeads / campaign.totalLeads) * 100) : 0;
    const successPct  = campaign.calledLeads > 0 ? Math.round((connected / campaign.calledLeads) * 100) : 0;

    const callIds = leads.filter(l => l.callId != null).map(l => l.callId!);
    let totalCostCents = 0;
    if (callIds.length > 0) {
      const calls = await db.select({ costCents: callsTable.costCents })
        .from(callsTable).where(inArray(callsTable.id, callIds));
      totalCostCents = calls.reduce((sum, c) => sum + (c.costCents ?? 0), 0);
    }

    return [
      csvCell(campaign.name),
      csvCell(campaign.status),
      csvCell(campaign.agentId != null ? (agentsMap.get(campaign.agentId) ?? "") : ""),
      csvCell(campaign.fromNumber ?? ""),
      csvCell(campaign.leadSource),
      csvCell(campaign.totalLeads),
      csvCell(campaign.calledLeads),
      csvCell(progressPct),
      csvCell(connected),
      csvCell(booked),
      csvCell(transferred),
      csvCell(callbacks),
      csvCell(failed),
      csvCell(successPct),
      csvCell((totalCostCents / 100).toFixed(3)),
      csvCell(campaign.createdAt.toISOString()),
    ].join(",");
  }));

  const csv = [headers.map(csvCell).join(","), ...rows].join("\r\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="campaigns-report.csv"`);
  res.send(csv);
});

// ── POST /campaigns ────────────────────────────────────────────────────────
router.post("/campaigns", async (req, res): Promise<void> => {
  try {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const parsed = CreateCampaignBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

    const fieldMappings: CampaignFieldMappings = parsed.data.fieldMappings
      ? (parsed.data.fieldMappings as CampaignFieldMappings)
      : { phone: "phone" };

    // ── Block platform-managed numbers from being used in campaigns ──
    // A number is "managed" only if it lives in the platform's managed_phone_numbers
    // pool (platform_settings). Numbers the user purchased themselves are in
    // phoneNumbersTable and are always allowed — they are the user's own numbers.
    if (parsed.data.fromNumber) {
      const selectedNumber = parsed.data.fromNumber;

      // Check if this number is one of the user's own purchased numbers first.
      // If it is, it is never a managed-platform number, regardless of VoBiz creds.
      const [ownedRow] = await db
        .select({ id: phoneNumbersTable.id })
        .from(phoneNumbersTable)
        .where(and(eq(phoneNumbersTable.userId, userId), eq(phoneNumbersTable.number, selectedNumber)));

      if (!ownedRow) {
        // Not in the user's own inventory — check if it's a platform-managed number safely.
        let managedPool: string[] = [];
        try {
          const [numbersRow] = await db
            .select({ value: platformSettingsTable.value })
            .from(platformSettingsTable)
            .where(eq(platformSettingsTable.key, "managed_phone_numbers"));

          if (typeof numbersRow?.value === "string") {
            managedPool = JSON.parse(numbersRow.value);
          } else if (Array.isArray(numbersRow?.value)) {
            managedPool = numbersRow.value as string[];
          }
        } catch {
          managedPool = [];
        }

        if (managedPool.includes(selectedNumber)) {
          res.status(403).json({
            error: "Platform managed numbers cannot be used for campaigns. Purchase your own number from Phone Numbers and use it here.",
            code: "MANAGED_NUMBER_CAMPAIGN_BLOCKED",
          });
          return;
        }
      }
    }

    // ── DPDP consent basis (record-keeping only — NEVER blocks dialing) ──
    // If the assigned agent has DPDP enabled, a documented consent basis must
    // accompany the campaign. This validates the audit record up front; it does
    // not gate or delay any outbound call.
    const consentBasis = parsed.data.consentBasis as ConsentBasisInput | undefined;
    const dpdpEnabled = await isAgentDpdpEnabled(parsed.data.agentId);
    if (dpdpEnabled) {
      const err = validateConsentBasis(consentBasis);
      if (err) { res.status(400).json({ error: err, code: "DPDP_CONSENT_BASIS_REQUIRED" }); return; }
    }

    // ── Hard platform ceiling on concurrent calls (max 10) ──
    if (parsed.data.concurrentCallLimit != null && parsed.data.concurrentCallLimit > MAX_CONCURRENT_CALLS) {
      res.status(400).json({
        error: `Max Concurrent Calls cannot exceed ${MAX_CONCURRENT_CALLS}.`,
        code: "CONCURRENT_LIMIT_EXCEEDED",
      });
      return;
    }

    const leadSource = (parsed.data as Record<string, unknown>)["leadSource"] as string ?? "csv";
    const isContinuous = ["webhook", "meta_ads", "crm"].includes(leadSource);

    const [campaign] = await db.insert(campaignsTable).values({
      userId,
      name:                parsed.data.name,
      description:         parsed.data.description,
      agentId:             parsed.data.agentId,
      fieldMappings,
      fromNumber:          parsed.data.fromNumber,
      concurrentCallLimit: parsed.data.concurrentCallLimit ?? MAX_CONCURRENT_CALLS,
      callDelaySeconds:    parsed.data.callDelaySeconds,
      maxAttempts:         parsed.data.maxAttempts,
      retryDelayMinutes:   parsed.data.retryDelayMinutes,
      leadSource,
      triggerMode:         isContinuous ? "instant" : ((parsed.data as Record<string, unknown>)["triggerMode"] as string ?? "batch"),
      webhookToken:        randomUUID(),
      status:              isContinuous ? "active" : "draft",
      isActive:            isContinuous,
    }).returning();

    if (dpdpEnabled && consentBasis) {
      try {
        await db.insert(campaignConsentBasisTable).values({
          campaignId:       campaign!.id,
          basisType:        consentBasis.basisType,
          attestedBy:       consentBasis.attestedBy ?? userId,
          consentSource:    consentBasis.consentSource ?? null,
          consentDateRange: consentBasis.consentDateRange ?? null,
          proofReference:   consentBasis.proofReference ?? null,
          notes:            consentBasis.notes ?? null,
        });
      } catch (err) {
        req.log.warn({ err, campaignId: campaign!.id }, "DPDP: failed to record campaign consent basis");
      }
    }

    res.status(201).json(toCampaign(campaign!));
  } catch (err: any) {
    req.log.error({ err }, "POST /campaigns failed");
    res.status(500).json({ error: err?.message || "Internal server error creating campaign" });
  }
});

// ── GET /campaigns/:id ─────────────────────────────────────────────────────
router.get("/campaigns/:id", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params["id"]!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid campaign ID" }); return; }
  const [row] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, userId)));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  // Count queued leads (arrived via webhook while no batch was running)
  const [queuedRow] = await db.select({ c: count() })
    .from(campaignLeadsTable)
    .where(and(
      eq(campaignLeadsTable.campaignId, id),
      isNull(campaignLeadsTable.batchId),
      eq(campaignLeadsTable.callStatus, "pending"),
    ));
  const queuedLeadsCount = Number(queuedRow?.c ?? 0);

  res.json({ ...toCampaign(row), queuedLeadsCount });
});

// ── PATCH /campaigns/:id ───────────────────────────────────────────────────
router.patch("/campaigns/:id", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params["id"]!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid campaign ID" }); return; }
  const parsed = UpdateCampaignBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  // ── Hard platform ceiling on concurrent calls (max 10) ──
  if (parsed.data.concurrentCallLimit != null && parsed.data.concurrentCallLimit > MAX_CONCURRENT_CALLS) {
    res.status(400).json({
      error: `Max Concurrent Calls cannot exceed ${MAX_CONCURRENT_CALLS}.`,
      code: "CONCURRENT_LIMIT_EXCEEDED",
    });
    return;
  }

  // If toggling isActive, also sync status field
  const { fieldMappings: rawMappings, metaPageAccessToken: rawMetaToken, isCallingHoursEnabled, ...rest } = parsed.data as typeof parsed.data & { metaPageAccessToken?: string | null };
  const updateData: Partial<typeof campaignsTable.$inferInsert> = { ...rest };
  // isCallingHoursEnabled is boolean (not nullable in schema); treat null as "leave unchanged"
  if (isCallingHoursEnabled != null) updateData.isCallingHoursEnabled = isCallingHoursEnabled;
  if (rawMappings) updateData.fieldMappings = rawMappings as CampaignFieldMappings;
  // Encrypt the Meta Page Access Token at rest (same pattern as provider API keys).
  // null clears the stored token; undefined means "not provided — leave unchanged".
  if (rawMetaToken !== undefined) {
    updateData.metaPageAccessToken = rawMetaToken ? encryptKey(rawMetaToken) : null;
  }
  if (parsed.data.isActive === true  && !parsed.data.status) updateData.status = "active";
  if (parsed.data.isActive === false && !parsed.data.status) updateData.status = "paused";

  // ── DPDP launch check (record-keeping only — NEVER blocks dialing) ──
  // Activating a campaign whose agent has DPDP enabled requires a documented
  // consent basis on record. This is a management-layer gate on campaign
  // activation, not a per-call dial gate — outbound calls are never blocked.
  const isActivating = updateData.status === "active" || parsed.data.isActive === true;
  if (isActivating) {
    const [existing] = await db
      .select({ agentId: campaignsTable.agentId })
      .from(campaignsTable)
      .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, userId)));
    if (existing && await isAgentDpdpEnabled(existing.agentId)) {
      const [basis] = await db
        .select({ id: campaignConsentBasisTable.id })
        .from(campaignConsentBasisTable)
        .where(eq(campaignConsentBasisTable.campaignId, id));
      if (!basis) {
        res.status(400).json({
          error: "This campaign's agent has DPDP compliance enabled. A documented consent basis must be recorded before launching the campaign.",
          code: "DPDP_CONSENT_BASIS_REQUIRED",
        });
        return;
      }
    }
  }

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
  if (isNaN(id)) { res.status(400).json({ error: "Invalid campaign ID" }); return; }
  const deleted = await db.delete(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, userId)))
    .returning();

  if (!deleted.length) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).end();
});

// ── GET /campaigns/:id/consent-basis ───────────────────────────────────────
// Returns the recorded DPDP consent basis for a campaign (audit-only), or null.
router.get("/campaigns/:id/consent-basis", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params["id"]!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid campaign ID" }); return; }
  const [campaign] = await db
    .select({ id: campaignsTable.id })
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, userId)));
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const [basis] = await db
    .select()
    .from(campaignConsentBasisTable)
    .where(eq(campaignConsentBasisTable.campaignId, id));

  res.json(basis ? toConsentBasisRecord(basis) : null);
});

// ── GET /campaigns/:id/leads ───────────────────────────────────────────────
router.get("/campaigns/:id/leads", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  if (isNaN(campaignId)) { res.status(400).json({ error: "Invalid campaign ID" }); return; }

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
  if (isNaN(campaignId)) { res.status(400).json({ error: "Invalid campaign ID" }); return; }

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
  if (isNaN(campaignId)) { res.status(400).json({ error: "Invalid campaign ID" }); return; }
  const [campaign] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const irdaiGate = await evaluateCampaignIrdaiGate(campaign.agentId);
  if (irdaiGate.blocked) {
    res.status(403).json({ error: IRDAI_BLOCKED_MESSAGE, code: IRDAI_BLOCKED_CODE, missingItems: irdaiGate.missingItems });
    return;
  }

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
  if (isNaN(campaignId) || isNaN(leadId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [campaign] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

  const [lead] = await db.select().from(campaignLeadsTable)
    .where(and(eq(campaignLeadsTable.id, leadId), eq(campaignLeadsTable.campaignId, campaignId)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const irdaiGate = await evaluateCampaignIrdaiGate(campaign.agentId);
  if (irdaiGate.blocked) {
    res.status(403).json({ error: IRDAI_BLOCKED_MESSAGE, code: IRDAI_BLOCKED_CODE, missingItems: irdaiGate.missingItems });
    return;
  }

  // Reset to pending, then fire
  const [updated] = await db.update(campaignLeadsTable)
    .set({ callStatus: "pending", notes: null })
    .where(eq(campaignLeadsTable.id, leadId))
    .returning();

  scheduleCampaignCall(updated!, campaign);
  res.json(toLead(updated!));
});

export default router;

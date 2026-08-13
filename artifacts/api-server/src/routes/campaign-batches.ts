import { Router, type IRouter } from "express";
import { getAuth } from "../lib/auth-compat.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext } from "../middlewares/clientContext.js";
import {
  db, campaignsTable, campaignBatchesTable, campaignLeadsTable, callsTable,
  leadTimelineTable, batchImportRunsTable, agentsTable,
  type CampaignFieldMappings,
} from "@workspace/db";
import { eq, and, count, desc, inArray, sql, isNull } from "drizzle-orm";
import { scheduleCampaignCall } from "../orchestration/campaignCaller.js";
import { reopenCampaignIfCompleted } from "../services/batchScheduler.js";
import { normalizePhone as normalizePhoneSimple } from "../lib/phone-normalize.js";
import { normalizePhone as normalizePhoneService, INDIA_PHONE_CONFIG, type WorkspacePhoneConfig } from "../services/phone-normalization.js";

// ISO 3166-1 alpha-2 → WorkspacePhoneConfig for phone normalisation
const COUNTRY_PHONE_CONFIGS: Record<string, WorkspacePhoneConfig> = {
  IN: { defaultCountryCode: "91", nationalDigitLength: 10 },
  US: { defaultCountryCode: "1",  nationalDigitLength: 10 },
  CA: { defaultCountryCode: "1",  nationalDigitLength: 10 },
  GB: { defaultCountryCode: "44", nationalDigitLength: 10 },
  AU: { defaultCountryCode: "61", nationalDigitLength: 9  },
  DE: { defaultCountryCode: "49", nationalDigitLength: 10 },
  FR: { defaultCountryCode: "33", nationalDigitLength: 9  },
  SG: { defaultCountryCode: "65", nationalDigitLength: 8  },
  AE: { defaultCountryCode: "971", nationalDigitLength: 9 },
  ZA: { defaultCountryCode: "27", nationalDigitLength: 9  },
};

function getPhoneConfig(countryCode?: string | null): WorkspacePhoneConfig {
  if (!countryCode) return INDIA_PHONE_CONFIG;
  return COUNTRY_PHONE_CONFIGS[countryCode.toUpperCase()] ?? INDIA_PHONE_CONFIG;
}
import { isOnDnc } from "../lib/dnc-check.js";

import {
  checkDuplicate, createImportSummary,
  type DuplicatePolicy, type DuplicateReportEntry,
} from "../services/duplicate-detection.js";
import { evaluateIrdaiGate, IRDAI_BLOCKED_MESSAGE, IRDAI_BLOCKED_CODE, type IrdaiGateResult } from "../services/irdai/gate.js";

const router: IRouter = Router();

router.use(requireAuth, clientContext);

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

type CampaignRow = typeof campaignsTable.$inferSelect;
type BatchRow    = typeof campaignBatchesTable.$inferSelect;

function toBatch(row: BatchRow, importSummary?: ImportSummaryResult | null) {
  return {
    id:                  row.id,
    campaignId:          row.campaignId,
    name:                row.name,
    description:         row.description ?? null,
    status:              row.status,
    leadSource:          row.leadSource,
    leadSourceId:        (row as Record<string, unknown>)["leadSourceId"] as number | null ?? null,
    batchFieldMapping:   (row as Record<string, unknown>)["batchFieldMapping"] as Record<string, string> | null ?? null,
    duplicatePolicy:     (row as Record<string, unknown>)["duplicatePolicy"] as string ?? "skip",
    scheduledStartAt:    row.scheduledStartAt?.toISOString() ?? null,
    scheduledEndAt:      row.scheduledEndAt?.toISOString() ?? null,
    totalLeads:          row.totalLeads,
    calledLeads:         row.calledLeads,
    fieldMappings:       row.fieldMappings ?? null,
    callDelaySeconds:    row.callDelaySeconds,
    maxAttempts:         row.maxAttempts,
    retryDelayMinutes:   row.retryDelayMinutes,
    timezone:            row.timezone ?? null,
    businessHoursStart:  row.businessHoursStart ?? null,
    businessHoursEnd:    row.businessHoursEnd ?? null,
    maxDailyCalls:       row.maxDailyCalls ?? null,
    createdAt:           row.createdAt.toISOString(),
    updatedAt:           row.updatedAt.toISOString(),
    importSummary:       importSummary ?? null,
  };
}

interface ImportSummaryResult {
  totalRows:       number;
  leadsCreated:    number;
  duplicatesFound: number;
  invalidPhones:   number;
  dncBlocked:      number;
  importRunId:     number | null;
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

/**
 * Auto-assign any queued leads (batchId = null, callStatus = 'pending') for this
 * campaign into the given batch.  Called every time a batch transitions to
 * "running" so leads that arrived while no batch was active are immediately
 * picked up.  Returns the number of leads reassigned.
 */
async function assignQueuedLeads(batchId: number, campaignId: number): Promise<number> {
  const result = await db.execute<{ id: number }>(sql`
    UPDATE campaign_leads
    SET batch_id = ${batchId}
    WHERE campaign_id = ${campaignId}
      AND batch_id IS NULL
      AND call_status = 'pending'
    RETURNING id
  `);
  const count = result.rows.length;
  if (count > 0) {
    await db.update(campaignBatchesTable)
      .set({ totalLeads: sql`${campaignBatchesTable.totalLeads} + ${count}` })
      .where(eq(campaignBatchesTable.id, batchId));
  }
  return count;
}

async function fireStartBatch(batch: BatchRow, campaign: CampaignRow): Promise<void> {
  // Pull in any leads that arrived while no batch was running
  await assignQueuedLeads(batch.id, campaign.id);

  const limit = campaign.concurrentCallLimit ?? 20;
  const [{ active }] = await db.select({ active: count() })
    .from(campaignLeadsTable)
    .where(and(
      eq(campaignLeadsTable.campaignId, campaign.id),
      inArray(campaignLeadsTable.callStatus, ["calling", "connected"]),
    ));
  const slots = Math.max(0, limit - Number(active));
  if (slots <= 0) return;

  // Atomically pre-claim pending leads to 'calling' before scheduling them.
  // The AND call_status = 'pending' guard on the outer WHERE means that under
  // READ COMMITTED isolation, a second concurrent UPDATE on the same rows sees
  // the already-committed 'calling' status and skips them — preventing
  // double-scheduling when the batch scheduler and a manual /start race.
  // NB: only call_status is written here. last_attempt_at is set by
  // fireCampaignCall at the moment a real dial is placed, so "Last Activity"
  // reflects an actual outbound attempt and never a mere pre-claim.
  const claimed = await db.execute<{ id: number }>(sql`
    UPDATE campaign_leads
    SET call_status = 'calling'
    WHERE id IN (
      SELECT id FROM campaign_leads
      WHERE campaign_id = ${campaign.id}
        AND batch_id = ${batch.id}
        AND call_status = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM call_retries cr
          WHERE cr.lead_id = campaign_leads.id
            AND cr.status = 'pending'
            AND cr.scheduled_at > now()
        )
      ORDER BY id
      LIMIT ${slots}
    )
    AND call_status = 'pending'
    RETURNING id
  `);

  const claimedIds = claimed.rows.map(r => r.id);
  if (claimedIds.length === 0) return;

  const claimedLeads = await db.select().from(campaignLeadsTable)
    .where(inArray(campaignLeadsTable.id, claimedIds));

  for (const lead of claimedLeads) {
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

  res.json(batches.map(b => toBatch(b)));
});

// ── POST /campaigns/:id/batches ───────────────────────────────────────────────
router.post("/campaigns/:id/batches", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const body = req.body as {
    name?: string;
    description?: string;
    leadSource?: string;
    leadSourceId?: number | null;
    leads?: unknown;
    fileName?: string;
    batchFieldMapping?: Record<string, string> | null;
    duplicatePolicy?: DuplicatePolicy;
    scheduledStartAt?: string | null;
    scheduledEndAt?: string | null;
    fieldMappings?: Record<string, string>;
    callDelaySeconds?: number;
    maxAttempts?: number;
    retryDelayMinutes?: number;
    timezone?: string;
    businessHoursStart?: number;
    businessHoursEnd?: number;
    maxDailyCalls?: number;
    autoStart?: boolean;
    countryCode?: string;
  };

  if (!body.name?.trim()) { res.status(400).json({ error: "Batch name required" }); return; }

  const startTime      = Date.now();
  const leadSource     = body.leadSource ?? "csv";
  const rawLeads       = Array.isArray(body.leads) ? (body.leads as Record<string, string>[]) : [];
  const duplicatePolicy: DuplicatePolicy = body.duplicatePolicy ?? "skip";

  if (leadSource === "csv" && rawLeads.length === 0) {
    res.status(400).json({ error: "leads must be a non-empty array for CSV batches" });
    return;
  }

  const legacyMappings = (body.fieldMappings ?? null) as CampaignFieldMappings | null;

  const [batch] = await db.insert(campaignBatchesTable).values({
    campaignId,
    name:               body.name.trim(),
    description:        body.description?.trim() ?? null,
    leadSource,
    scheduledStartAt:   body.scheduledStartAt ? new Date(body.scheduledStartAt) : null,
    scheduledEndAt:     body.scheduledEndAt ? new Date(body.scheduledEndAt) : null,
    fieldMappings:      legacyMappings ?? undefined,
    callDelaySeconds:   body.callDelaySeconds ?? 5,
    maxAttempts:        body.maxAttempts ?? 1,
    retryDelayMinutes:  body.retryDelayMinutes ?? 60,
    timezone:           body.timezone ?? null,
    businessHoursStart: body.businessHoursStart ?? null,
    businessHoursEnd:   body.businessHoursEnd ?? null,
    maxDailyCalls:      body.maxDailyCalls ?? null,
    leadSourceId:       body.leadSourceId ?? null,
    batchFieldMapping:  body.batchFieldMapping ?? null,
    duplicatePolicy:    body.duplicatePolicy ?? "skip",
  } as typeof campaignBatchesTable.$inferInsert).returning();

  // Determine column mapping
  const bfm = body.batchFieldMapping ?? null;
  const cfm = (campaign.fieldMappings ?? {}) as CampaignFieldMappings;
  const phoneField = bfm?.["phone"] ?? cfm?.phone ?? "phone";
  const nameField  = bfm?.["name"]  ?? cfm?.name  ?? "name";
  const emailField = bfm?.["email"] ?? cfm?.email ?? "email";

  const toInsert: (typeof campaignLeadsTable.$inferInsert)[] = [];
  const errorEntries: DuplicateReportEntry[] = [];
  let dncBlocked    = 0;
  let invalidPhones = 0;
  let duplicatesFound = 0;

  for (let i = 0; i < rawLeads.length; i++) {
    const row     = rawLeads[i]!;
    const rawPhone = (row[phoneField] ?? row["phone"] ?? "").trim();
    if (!rawPhone) { invalidPhones++; continue; }

    // Normalize using the comprehensive service
    const normResult = normalizePhoneService(rawPhone, getPhoneConfig(body.countryCode));
    if (!normResult.valid || !normResult.normalized) {
      invalidPhones++;
      errorEntries.push({
        phone:           rawPhone,
        normalizedPhone: rawPhone,
        reason:          "duplicate_phone", // re-using existing type; reason is invalid
        existingLeadId:  0,
        rowIndex:        i,
      } as DuplicateReportEntry & { reason: string });
      continue;
    }

    // DNC check
    if (await isOnDnc(campaign.userId, normResult.normalized)) { dncBlocked++; continue; }

    // Duplicate check with policy
    const dupResult = await checkDuplicate(db, {
      normalizedPhone: normResult.normalized,
      campaignId,
      policy:          duplicatePolicy,
    });

    if (dupResult.action === "skip" || dupResult.action === "reject") {
      duplicatesFound++;
      if (dupResult.reportEntry) {
        errorEntries.push({ ...dupResult.reportEntry, rowIndex: i });
      }
      continue;
    }

    const name  = (row[nameField]  ?? row["name"]  ?? "").trim() || null;
    const email = (row[emailField] ?? row["email"] ?? "").trim() || null;
    const leadData: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) { if (v?.trim()) leadData[k] = v.trim(); }

    toInsert.push({
      campaignId,
      batchId:         batch!.id,
      phone:           rawPhone,
      normalizedPhone: normResult.normalized,
      name,
      email,
      leadData,
      source:          "csv",
      ...(dupResult.isDuplicate ? { duplicateStatus: "duplicate" } : {}),
    });
  }

  const imported = toInsert.length;
  if (imported > 0) {
    const insertedLeads: (typeof campaignLeadsTable.$inferSelect)[] = [];
    for (let i = 0; i < toInsert.length; i += 100) {
      const chunk = await db.insert(campaignLeadsTable).values(toInsert.slice(i, i + 100)).returning();
      insertedLeads.push(...chunk);
    }
    if (insertedLeads.length > 0) {
      await db.insert(leadTimelineTable).values(
        insertedLeads.map(l => ({
          leadId:    l.id,
          campaignId,
          eventType: "imported",
          data:      { source: "csv", batchId: batch!.id },
        }))
      );
    }
    await db.update(campaignBatchesTable).set({ totalLeads: imported }).where(eq(campaignBatchesTable.id, batch!.id));
    await db.update(campaignsTable)
      .set({ totalLeads: campaign.totalLeads + imported })
      .where(eq(campaignsTable.id, campaignId));
  }

  // Create batch_import_run for audit trail
  let importRunId: number | null = null;
  if (rawLeads.length > 0) {
    const [run] = await db.insert(batchImportRunsTable).values({
      batchId:          batch!.id,
      sourceId:         body.leadSourceId ?? null,
      fileName:         body.fileName?.trim() ?? null,
      status:           "completed",
      totalRows:        rawLeads.length,
      validRows:        imported,
      invalidRows:      invalidPhones,
      duplicateRows:    duplicatesFound,
      createdRows:      imported,
      processingTimeMs: Date.now() - startTime,
      errorReport:      errorEntries.length > 0 ? errorEntries : null,
    } as typeof batchImportRunsTable.$inferInsert).returning();
    importRunId = run?.id ?? null;
  }

  let [fresh] = await db.select().from(campaignBatchesTable).where(eq(campaignBatchesTable.id, batch!.id));

  const wantsImmediateStart =
    (fresh && fresh.scheduledStartAt && fresh.scheduledStartAt <= new Date()) || !!body.autoStart;
  if (wantsImmediateStart) {
    const irdaiGate = await evaluateCampaignIrdaiGate(campaign.agentId);
    if (irdaiGate.blocked) {
      res.status(403).json({ error: IRDAI_BLOCKED_MESSAGE, code: IRDAI_BLOCKED_CODE, missingItems: irdaiGate.missingItems });
      return;
    }
    await db.update(campaignBatchesTable).set({ status: "running" }).where(eq(campaignBatchesTable.id, fresh!.id));
    // New batch of work — reopen the campaign if the scheduler auto-completed it.
    await reopenCampaignIfCompleted(campaign.id);
    await fireStartBatch(fresh!, campaign);
    // Reflect the status update in the object used to build the response so the
    // frontend sees "running" immediately instead of the stale "draft" value.
    fresh = { ...fresh!, status: "running" as const };
  }

  const summary: ImportSummaryResult = {
    totalRows:       rawLeads.length,
    leadsCreated:    imported,
    duplicatesFound,
    invalidPhones,
    dncBlocked,
    importRunId,
  };

  res.status(201).json(toBatch(fresh!, summary));
});

// ── POST /campaigns/:id/validate-leads (stateless preview) ───────────────────
router.post("/campaigns/:id/validate-leads", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const body = req.body as {
    leads?: Record<string, string>[];
    fieldMapping?: Record<string, string>;
    policy?: DuplicatePolicy;
    countryCode?: string;
  };

  const leads       = Array.isArray(body.leads) ? body.leads : [];
  const fieldMapping = body.fieldMapping ?? {};
  const policy: DuplicatePolicy = body.policy ?? "skip";
  const phoneField = fieldMapping["phone"] ?? "phone";

  const rows: Array<{
    rowIndex:        number;
    raw:             Record<string, string>;
    normalized:      string | null;
    phoneValid:      boolean;
    isDuplicate:     boolean;
    status:          "valid" | "warning" | "error";
    errors:          string[];
  }> = [];

  let validRows     = 0;
  let invalidRows   = 0;
  let duplicateRows = 0;

  // Preview up to 200 rows to avoid timeouts; show all counts
  const previewLimit = 200;

  for (let i = 0; i < leads.length; i++) {
    const row      = leads[i]!;
    const rawPhone = (row[phoneField] ?? row["phone"] ?? "").trim();

    if (!rawPhone) {
      invalidRows++;
      if (i < previewLimit) {
        rows.push({
          rowIndex:    i,
          raw:         row,
          normalized:  null,
          phoneValid:  false,
          isDuplicate: false,
          status:      "error",
          errors:      ["Phone number is empty"],
        });
      }
      continue;
    }

    const normResult = normalizePhoneService(rawPhone, getPhoneConfig(body.countryCode));

    let isDuplicate = false;
    if (normResult.valid && normResult.normalized) {
      const dupResult = await checkDuplicate(db, {
        normalizedPhone: normResult.normalized,
        campaignId,
        policy,
      });
      isDuplicate = dupResult.isDuplicate;
    }

    let status: "valid" | "warning" | "error" = "valid";
    const errors: string[] = [];

    if (!normResult.valid) {
      status = "error";
      errors.push(normResult.reason ?? "Invalid phone number");
      invalidRows++;
    } else if (isDuplicate) {
      status = "warning";
      errors.push("Duplicate phone in campaign");
      duplicateRows++;
    } else {
      validRows++;
    }

    if (i < previewLimit) {
      rows.push({
        rowIndex:    i,
        raw:         row,
        normalized:  normResult.normalized,
        phoneValid:  normResult.valid,
        isDuplicate,
        status,
        errors,
      });
    }
  }

  res.json({
    totalRows:    leads.length,
    validRows,
    invalidRows,
    duplicateRows,
    previewRows:  rows,
  });
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

  const body = req.body as {
    status?: string;
    scheduledStartAt?: string | null;
    maxAttempts?: number;
    retryDelayMinutes?: number;
    timezone?: string | null;
    batchFieldMapping?: Record<string, string> | null;
    rematerializePending?: boolean;
  };

  if (body.status === "running" && batch.status !== "running") {
    const irdaiGate = await evaluateCampaignIrdaiGate(campaign.agentId);
    if (irdaiGate.blocked) {
      res.status(403).json({ error: IRDAI_BLOCKED_MESSAGE, code: IRDAI_BLOCKED_CODE, missingItems: irdaiGate.missingItems });
      return;
    }
  }

  const updateData: Partial<typeof campaignBatchesTable.$inferInsert> = {};
  if (body.status) updateData.status = body.status;
  if ("scheduledStartAt" in body) {
    updateData.scheduledStartAt = body.scheduledStartAt ? new Date(body.scheduledStartAt) : null;
  }
  if (body.maxAttempts != null) updateData.maxAttempts = body.maxAttempts;
  if (body.retryDelayMinutes != null) updateData.retryDelayMinutes = body.retryDelayMinutes;
  if ("timezone" in body) updateData.timezone = body.timezone ?? null;
  if ("batchFieldMapping" in body) {
    updateData.batchFieldMapping = body.batchFieldMapping ?? null;
  }

  const [updated] = await db.update(campaignBatchesTable)
    .set(updateData)
    .where(eq(campaignBatchesTable.id, batchId))
    .returning();

  let rematerialized = 0;
  if (body.rematerializePending === true) {
    const mapping =
      (updated?.batchFieldMapping as Record<string, string> | null) ??
      (body.batchFieldMapping ?? null) ??
      {};
    const cfm = (campaign.fieldMappings ?? {}) as CampaignFieldMappings;
    const phoneField = mapping["phone"] ?? cfm?.phone ?? "phone";
    const nameField = mapping["name"] ?? cfm?.name ?? "name";
    const emailField = mapping["email"] ?? cfm?.email ?? "email";

    const pending = await db
      .select()
      .from(campaignLeadsTable)
      .where(
        and(
          eq(campaignLeadsTable.campaignId, campaignId),
          sql`${campaignLeadsTable.batchId} = ${batchId}`,
          eq(campaignLeadsTable.callStatus, "pending"),
        ),
      );

    for (const lead of pending) {
      const row = (lead.leadData ?? {}) as Record<string, string>;
      const rawPhone = (row[phoneField] ?? row["phone"] ?? lead.phone ?? "").trim();
      if (!rawPhone) continue;
      const normResult = normalizePhoneService(rawPhone, INDIA_PHONE_CONFIG);
      const name = (row[nameField] ?? row["name"] ?? "").trim() || null;
      const email = (row[emailField] ?? row["email"] ?? "").trim() || null;
      await db
        .update(campaignLeadsTable)
        .set({
          phone: rawPhone,
          normalizedPhone: normResult.normalized ?? lead.normalizedPhone,
          name,
          email,
        })
        .where(eq(campaignLeadsTable.id, lead.id));
      rematerialized++;
    }
  }

  if (body.status === "running" && batch.status !== "running") {
    // Work is re-entering — reopen the campaign if the scheduler auto-completed it.
    await reopenCampaignIfCompleted(campaignId);
    await fireStartBatch(updated!, campaign);
  }

  res.json({ ...toBatch(updated!), rematerialized });
});

// ── POST /campaigns/:id/batches/:batchId/start ────────────────────────────────
// Dedicated "start now" endpoint — sets the batch to running and fires the
// first wave of calls up to the campaign's concurrentCallLimit immediately,
// regardless of scheduledStartAt. The dashboard Start button and any API
// clients should prefer this over PATCH {status:"running"}.
router.post("/campaigns/:id/batches/:batchId/start", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const batchId    = parseInt(req.params["batchId"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const batch = await requireBatch(batchId, campaignId);
  if (!batch) { res.status(404).json({ error: "Not found" }); return; }

  // Idempotent: already running — return current state without re-queueing
  if (batch.status === "running") {
    res.json(toBatch(batch));
    return;
  }

  if (batch.status === "completed" || batch.status === "cancelled") {
    res.status(409).json({ error: `Cannot start a batch in "${batch.status}" status` });
    return;
  }

  const irdaiGate = await evaluateCampaignIrdaiGate(campaign.agentId);
  if (irdaiGate.blocked) {
    res.status(403).json({ error: IRDAI_BLOCKED_MESSAGE, code: IRDAI_BLOCKED_CODE, missingItems: irdaiGate.missingItems });
    return;
  }

  const [updated] = await db.update(campaignBatchesTable)
    .set({ status: "running" })
    .where(eq(campaignBatchesTable.id, batchId))
    .returning();

  // Work is re-entering — reopen the campaign if the scheduler auto-completed it.
  await reopenCampaignIfCompleted(campaignId);
  await fireStartBatch(updated!, campaign);

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

// ── GET /campaigns/:id/batches/:batchId/export.csv ────────────────────────────
const BATCH_EXPORT_STATUS_LABEL: Record<string, string> = {
  pending:   "Pending",
  calling:   "Calling",
  connected: "In Progress",
  completed: "Completed",
  voicemail: "Voicemail",
  failed:    "Failed",
  busy:      "Busy",
  skipped:   "Skipped",
};

const BATCH_EXPORT_OUTCOME_LABEL: Record<string, string> = {
  pending:            "Pending",
  booking_created:    "Booked",
  transfer_completed: "Transferred",
  callback_requested: "Callback",
  interest_confirmed: "Interested",
  no_contact:         "No Contact",
  dnc_blocked:        "DNC",
  failed:             "Failed",
};

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

router.get("/campaigns/:id/batches/:batchId/export.csv", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const batchId    = parseInt(req.params["batchId"]!, 10);
  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const batch = await requireBatch(batchId, campaignId);
  if (!batch) { res.status(404).json({ error: "Not found" }); return; }

  const leads = await db.select().from(campaignLeadsTable)
    .where(and(
      eq(campaignLeadsTable.campaignId, campaignId),
      sql`${campaignLeadsTable.batchId} = ${batchId}`,
    ))
    .orderBy(desc(campaignLeadsTable.createdAt));

  const callIds = leads.filter(l => l.callId).map(l => l.callId!);
  const callsMap = new Map<number, typeof callsTable.$inferSelect>();
  if (callIds.length > 0) {
    const calls = await db.select().from(callsTable).where(inArray(callsTable.id, callIds));
    for (const c of calls) callsMap.set(c.id, c);
  }

  const maxAttempts = batch.maxAttempts ?? campaign.maxAttempts ?? 1;

  const headers = [
    "Lead Name", "Phone Number", "Email", "Date & Time", "Call ID",
    "Status", "Outcome", "Attempts", "Duration (s)", "Cost ($)",
    "Disposition", "Notes", "Summary", "Transcript",
  ];

  const rows = leads.map(lead => {
    const call = lead.callId ? callsMap.get(lead.callId) : undefined;
    const currentAttempt = Math.min(Math.max(1, lead.callAttempts), maxAttempts);
    return [
      csvCell(lead.name ?? ""),
      csvCell(lead.phone),
      csvCell(lead.email ?? ""),
      csvCell(lead.lastAttemptAt ? lead.lastAttemptAt.toISOString() : ""),
      csvCell(lead.callId ?? ""),
      csvCell(BATCH_EXPORT_STATUS_LABEL[lead.callStatus] ?? lead.callStatus),
      csvCell(BATCH_EXPORT_OUTCOME_LABEL[lead.operationalOutcome] ?? lead.operationalOutcome),
      csvCell(`${currentAttempt} of ${maxAttempts}`),
      csvCell(call?.durationSeconds ?? ""),
      csvCell(call?.costCents != null ? (call.costCents / 100).toFixed(3) : ""),
      csvCell(lead.disposition ?? ""),
      csvCell(lead.notes ?? ""),
      csvCell(call?.callSummary ?? ""),
      csvCell(call?.transcript ?? ""),
    ].join(",");
  });

  // UTF-8 BOM so Excel opens Devanagari/other non-ASCII transcripts correctly.
  const csv = "\uFEFF" + [headers.map(csvCell).join(","), ...rows].join("\r\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="batch-${batchId}-report.csv"`);
  res.send(csv);
});

// ── GET /campaigns/:id/batches/:batchId/import-runs/:runId/report.csv ─────────
router.get("/campaigns/:id/batches/:batchId/import-runs/:runId/report.csv", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  const batchId    = parseInt(req.params["batchId"]!, 10);
  const runId      = parseInt(req.params["runId"]!, 10);

  const campaign = await requireCampaign(campaignId, userId);
  if (!campaign) { res.status(404).json({ error: "Not found" }); return; }

  const batch = await requireBatch(batchId, campaignId);
  if (!batch) { res.status(404).json({ error: "Not found" }); return; }

  const [run] = await db.select().from(batchImportRunsTable)
    .where(and(eq(batchImportRunsTable.id, runId), eq(batchImportRunsTable.batchId, batchId)));
  if (!run) { res.status(404).json({ error: "Import run not found" }); return; }

  const errors = (run.errorReport as (DuplicateReportEntry & { reason: string; rowIndex?: number })[] | null) ?? [];

  const lines = [
    "row_index,phone,normalized_phone,reason,existing_lead_id",
    ...errors.map(e => [
      e.rowIndex ?? "",
      `"${(e.phone ?? "").replace(/"/g, '""')}"`,
      `"${(e.normalizedPhone ?? "").replace(/"/g, '""')}"`,
      `"${(e.reason ?? "").replace(/"/g, '""')}"`,
      e.existingLeadId ?? "",
    ].join(","))
  ];

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="import-run-${runId}-errors.csv"`);
  res.send(lines.join("\r\n"));
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

  const irdaiGate = await evaluateCampaignIrdaiGate(campaign.agentId);
  if (irdaiGate.blocked) {
    res.status(403).json({ error: IRDAI_BLOCKED_MESSAGE, code: IRDAI_BLOCKED_CODE, missingItems: irdaiGate.missingItems });
    return;
  }

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

  // Work re-opened: reopen a completed batch so the rolling-refill poll (which
  // only queries running batches) tops it up, and reopen an auto-completed
  // campaign so it becomes dialable again.
  if (queued > 0) {
    await db.update(campaignBatchesTable)
      .set({ status: "running" })
      .where(and(
        eq(campaignBatchesTable.id, batchId),
        eq(campaignBatchesTable.status, "completed"),
      ));
    await reopenCampaignIfCompleted(campaignId);
  }

  res.json({ queued });
});

export default router;

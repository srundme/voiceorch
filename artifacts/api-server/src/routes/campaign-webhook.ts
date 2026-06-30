/**
 * Universal campaign lead webhook
 * ──────────────────────────────────────────────────────────────────────────
 * Public endpoints (no Clerk auth). Two lead sources:
 *
 * 1. Website / generic form — any JSON or URL-encoded POST
 * 2. Instagram Lead Ads — Meta's leadgen webhook format
 *    GET  /api/webhooks/lead/:token  — webhook verification (hub.challenge)
 *    POST /api/webhooks/lead/:token  — lead event notification
 *
 * Field mapping is configured per-campaign. The campaign's `fieldMappings`
 * object maps source field names → roles (phone, name, email, custom vars).
 *
 * Security: if a campaign has `hmacSecret` set, inbound POST requests must
 * carry X-Hub-Signature-256: sha256=<hmac> (computed over the raw body).
 * Token-only sources (no hmacSecret) continue to work unchanged.
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db, campaignsTable, campaignLeadsTable, campaignBatchesTable, leadTimelineTable, agentsTable } from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { scheduleCampaignCall } from "../orchestration/campaignCaller.js";
import { normalizePhone } from "../lib/phone-normalize.js";
import { isOnDnc } from "../lib/dnc-check.js";
import { captureListenSample } from "./connections.js";

const router: IRouter = Router();

// ── Public CORS for the lead webhook (used by the embed widget) ────────────
// The global CORS config in app.ts allows only known dashboard origins in
// production, but browser-initiated fetch from embed widgets on arbitrary
// third-party sites must be allowed. We open these two specific public paths
// to all origins while keeping every other route restricted.
function publicCors(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Hub-Signature-256, X-Signature-256, X-Signature");
  next();
}

router.options("/webhooks/lead/:token", publicCors, (_req, res) => { res.sendStatus(204); });

// ── Helpers ────────────────────────────────────────────────────────────────

/** Flatten a nested object into dot-notation keys */
function flattenObject(obj: unknown, prefix = ""): Record<string, string> {
  if (typeof obj !== "object" || obj === null) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      Object.assign(out, flattenObject(v, key));
    } else if (Array.isArray(v)) {
      out[key] = v.map(String).join(",");
    } else {
      out[key] = String(v ?? "");
    }
  }
  return out;
}

/**
 * Apply fieldMappings to an incoming flat data object.
 * Returns { phone, name, email, leadData } where leadData is the full flat map.
 */
function extractLeadFields(
  flatData: Record<string, string>,
  fieldMappings: Record<string, string>,
): { phone: string | null; name: string | null; email: string | null; leadData: Record<string, string> } {
  // Invert the mapping: role → source field name
  const phoneKey = fieldMappings["phone"] ?? "phone";
  const nameKey  = fieldMappings["name"]  ?? "name";
  const emailKey = fieldMappings["email"] ?? "email";

  return {
    phone:    flatData[phoneKey] ?? flatData["phone"] ?? null,
    name:     flatData[nameKey]  ?? flatData["name"]  ?? null,
    email:    flatData[emailKey] ?? flatData["email"] ?? null,
    leadData: flatData,
  };
}

/**
 * Verify X-Hub-Signature-256 HMAC signature.
 * Returns true if valid (or if secret is not configured — backward compat).
 */
function verifyHmacSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  try {
    return timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Find or create today's auto-dialing batch for webhook-sourced leads.
 *
 * Named "Live — {Month Day}" (e.g. "Live — Jun 30").  A single batch covers
 * all webhook leads that arrive on the same calendar day.  The batch is set to
 * "running" immediately so each new lead triggers a call without any manual
 * "Create Batch → Start Batch" step.
 *
 * If a same-day batch already exists but is completed/draft (e.g. the batch
 * scheduler closed it after it finished), it is re-opened to "running" so
 * new same-day leads keep flowing.
 */
async function getOrCreateLiveBatch(
  campaignId: number,
  timezone = "Asia/Kolkata",
): Promise<typeof campaignBatchesTable.$inferSelect | null> {
  const now       = new Date();
  // Use the agent's configured IANA timezone so daily batch boundaries match
  // the agent's local calendar date, not UTC.
  const batchName = `Live — ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: timezone })}`;

  // Check for an existing auto-batch created today for this campaign
  const existing = await db.query.campaignBatchesTable.findFirst({
    where: and(
      eq(campaignBatchesTable.campaignId, campaignId),
      eq(campaignBatchesTable.leadSource, "webhook"),
      sql`${campaignBatchesTable.name} = ${batchName}`,
    ),
    orderBy: (t, { desc }) => [desc(t.id)],
  });

  if (existing) {
    if (existing.status !== "running") {
      await db.update(campaignBatchesTable)
        .set({ status: "running" })
        .where(eq(campaignBatchesTable.id, existing.id));
    }
    return { ...existing, status: "running" };
  }

  // Create a fresh live batch for today
  const [batch] = await db.insert(campaignBatchesTable).values({
    campaignId,
    name:              batchName,
    description:       "Auto-created — incoming website leads are dialled immediately",
    leadSource:        "webhook",
    callDelaySeconds:  0,
    maxAttempts:       2,
    retryDelayMinutes: 60,
    duplicatePolicy:   "skip",
  } as typeof campaignBatchesTable.$inferInsert).returning();

  if (!batch) {
    logger.warn({ campaignId }, "Failed to create live batch for webhook lead");
    return null;
  }

  await db.update(campaignBatchesTable)
    .set({ status: "running" })
    .where(eq(campaignBatchesTable.id, batch.id));

  logger.info({ campaignId, batchId: batch.id, batchName }, "Auto-created live batch for webhook leads");
  return { ...batch, status: "running" };
}

async function insertLeadAndSchedule(opts: {
  campaignId: number;
  phone: string;
  name: string | null;
  email: string | null;
  leadData: Record<string, string>;
  source: string;
  externalLeadId?: string | null;
}): Promise<void> {
  const campaign = await db.query.campaignsTable.findFirst({
    where: eq(campaignsTable.id, opts.campaignId),
  });

  if (!campaign) {
    logger.info({ campaignId: opts.campaignId }, "Campaign not found — lead dropped");
    return;
  }

  // Find the currently running batch for this campaign (if any).
  const runningBatch = await db.query.campaignBatchesTable.findFirst({
    where: and(
      eq(campaignBatchesTable.campaignId, opts.campaignId),
      eq(campaignBatchesTable.status, "running"),
    ),
    orderBy: (t, { desc }) => [desc(t.id)],
  });

  const normalized = normalizePhone(opts.phone);

  // DNC check
  if (await isOnDnc(campaign.userId, normalized)) {
    logger.info({ phone: normalized, campaignId: opts.campaignId }, "Webhook lead blocked by DNC");
    return;
  }

  // Deduplicate by externalLeadId if provided
  if (opts.externalLeadId) {
    const existing = await db.query.campaignLeadsTable.findFirst({
      where: eq(campaignLeadsTable.externalLeadId, opts.externalLeadId),
    });
    if (existing) {
      logger.info({ externalLeadId: opts.externalLeadId }, "Duplicate lead — skipping");
      return;
    }
  }

  // For webhook / Instagram-Ads leads: if no batch is currently running, auto-
  // create (or reuse) today's "Live — {date}" batch so the call fires immediately.
  // CSV leads always arrive pre-assigned to a manually created batch — unchanged.
  const isWebhookSource = opts.source === "webhook" || opts.source === "instagram_ads";

  // Resolve the agent's IANA timezone for date-boundary decisions.
  let agentTimezone = "Asia/Kolkata";
  if (campaign.agentId) {
    const agent = await db.query.agentsTable.findFirst({
      where: eq(agentsTable.id, campaign.agentId),
      columns: { agentConfig: true },
    });
    const tz = (agent?.agentConfig as Record<string, unknown> | null)?.["timezone"];
    if (typeof tz === "string" && tz.length > 0) agentTimezone = tz;
  }

  const targetBatch =
    runningBatch ??
    (isWebhookSource ? await getOrCreateLiveBatch(opts.campaignId, agentTimezone) : null);

  const [lead] = await db.insert(campaignLeadsTable).values({
    campaignId:      opts.campaignId,
    batchId:         targetBatch?.id ?? null,
    phone:           opts.phone,
    normalizedPhone: normalized,
    name:            opts.name,
    email:           opts.email,
    leadData:        opts.leadData,
    source:          opts.source,
    externalLeadId:  opts.externalLeadId ?? null,
    callStatus:      "pending",
  }).returning();

  await db.insert(leadTimelineTable).values({
    leadId:     lead!.id,
    campaignId: opts.campaignId,
    eventType:  "imported",
    data:       { source: opts.source, externalLeadId: opts.externalLeadId ?? null, batchId: targetBatch?.id ?? null },
  });

  // Increment totalLeads on campaign and on the batch (if resolved)
  await db.update(campaignsTable)
    .set({ totalLeads: sql`${campaignsTable.totalLeads} + 1` })
    .where(eq(campaignsTable.id, opts.campaignId));

  if (targetBatch) {
    await db.update(campaignBatchesTable)
      .set({ totalLeads: sql`${campaignBatchesTable.totalLeads} + 1` })
      .where(eq(campaignBatchesTable.id, targetBatch.id));

    // Dial immediately
    scheduleCampaignCall(lead!, campaign);
    logger.info(
      { campaignId: opts.campaignId, leadId: lead!.id, batchId: targetBatch.id, source: opts.source },
      "Webhook lead dispatched for immediate dial",
    );
  } else {
    // No batch resolved (CSV lead with no running batch, or live-batch creation failed)
    logger.info(
      { campaignId: opts.campaignId, leadId: lead!.id },
      "Lead queued (batchId=null) — will dial when next batch starts",
    );
  }
}

/** Mark last webhook event on the campaign row (fire-and-forget, best-effort). */
function touchWebhookStatus(campaignId: number, status: "ok" | "error"): void {
  db.update(campaignsTable)
    .set({ lastWebhookAt: new Date(), lastWebhookStatus: status })
    .where(eq(campaignsTable.id, campaignId))
    .catch((err: unknown) => logger.warn({ err, campaignId }, "Failed to update webhook status"));
}

// ── GET /api/webhooks/lead/:token — Instagram Meta verification ────────────
router.get("/webhooks/lead/:token", publicCors, (req, res): void => {
  const mode      = req.query["hub.mode"]         as string | undefined;
  const token     = req.query["hub.verify_token"] as string | undefined;
  const challenge = req.query["hub.challenge"]    as string | undefined;

  // If this is a Meta webhook verification request
  if (mode === "subscribe" && token === req.params["token"]) {
    res.status(200).send(challenge ?? "ok");
    return;
  }

  // Otherwise return 200 (used for health checks / webhook URL verification)
  res.status(200).json({ ok: true });
});

// ── POST /api/webhooks/lead/:token — Universal lead intake ─────────────────
router.post("/webhooks/lead/:token", publicCors, async (req, res): Promise<void> => {
  const token = req.params["token"] as string;

  // Look up campaign by webhook token
  const campaign = await db.query.campaignsTable.findFirst({
    where: eq(campaignsTable.webhookToken, token),
  });

  if (!campaign) {
    res.status(404).json({ error: "Unknown webhook token" });
    return;
  }

  const body = req.body as Record<string, unknown>;

  // ── HMAC Signature verification ──────────────────────────────────────────
  if (campaign.hmacSecret) {
    const rawBody: Buffer | string = (req as any).rawBody ?? JSON.stringify(body);
    const sig = req.headers["x-hub-signature-256"] as string | undefined
             ?? req.headers["x-signature-256"]     as string | undefined
             ?? req.headers["x-signature"]          as string | undefined;
    if (!verifyHmacSignature(rawBody, sig, campaign.hmacSecret)) {
      logger.warn({ campaignId: campaign.id }, "Webhook HMAC verification failed");
      touchWebhookStatus(campaign.id, "error");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
  }

  // ── Capture for listen mode (sample capture — not a real lead) ───────────
  // If an active listen session is waiting, capture this payload and return
  // early WITHOUT creating a lead or scheduling a call. This ensures test
  // events sent during onboarding never create real leads.
  const flat = flattenObject(body);
  if (captureListenSample(campaign.id, body, flat)) {
    logger.info({ campaignId: campaign.id }, "Webhook payload captured for listen mode — not ingested as lead");
    touchWebhookStatus(campaign.id, "ok");
    res.json({ received: true, mode: "listen_sample" });
    return;
  }

  // ── Detect Instagram Lead Ads format ─────────────────────────────────────
  if (body["object"] === "page" && Array.isArray(body["entry"])) {
    // Meta leadgen webhook — iterate entries/changes
    for (const entry of body["entry"] as Array<Record<string, unknown>>) {
      const changes = Array.isArray(entry["changes"]) ? entry["changes"] : [];
      for (const change of changes as Array<Record<string, unknown>>) {
        if (change["field"] !== "leadgen") continue;

        const value = change["value"] as Record<string, unknown> | undefined;
        if (!value) continue;

        const leadgenId = String(value["leadgen_id"] ?? "");
        const fieldData = Array.isArray(value["field_data"]) ? value["field_data"] : [];

        // Convert Meta field_data array → flat map
        const metaFlat: Record<string, string> = {};
        for (const fd of fieldData as Array<{ name: string; values: string[] }>) {
          metaFlat[fd.name] = fd.values?.[0] ?? "";
        }

        const { phone, name, email, leadData } = extractLeadFields(metaFlat, campaign.fieldMappings as Record<string, string>);

        if (!phone) {
          logger.warn({ campaignId: campaign.id, leadgenId }, "Instagram lead missing phone — skipping");
          continue;
        }

        await insertLeadAndSchedule({
          campaignId:     campaign.id,
          phone,
          name,
          email,
          leadData,
          source:         "instagram_ads",
          externalLeadId: leadgenId || null,
        }).catch((err: unknown) => logger.error({ err, campaignId: campaign.id }, "Failed to process Instagram lead"));
      }
    }

    touchWebhookStatus(campaign.id, "ok");
    res.json({ received: true });
    return;
  }

  // ── Generic website / form webhook ──────────────────────────────────────
  const { phone, name, email, leadData } = extractLeadFields(flat, campaign.fieldMappings as Record<string, string>);

  if (!phone) {
    touchWebhookStatus(campaign.id, "error");
    res.status(422).json({ error: "Could not extract phone number. Check your fieldMappings configuration." });
    return;
  }

  await insertLeadAndSchedule({
    campaignId: campaign.id,
    phone,
    name,
    email,
    leadData,
    source:     "webhook",
  });

  touchWebhookStatus(campaign.id, "ok");
  res.json({ received: true, phone });
});

export default router;

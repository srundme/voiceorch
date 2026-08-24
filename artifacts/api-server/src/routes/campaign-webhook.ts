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
import { db, campaignsTable, campaignLeadsTable, campaignBatchesTable, leadTimelineTable, agentsTable, type CampaignValidationError } from "@workspace/db";
import { decryptKey } from "../lib/crypto.js";
import { eq, sql, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { scheduleCampaignCall } from "../orchestration/campaignCaller.js";
import { normalizePhone } from "../lib/phone-normalize.js";
import { isOnDnc } from "../lib/dnc-check.js";
import { captureListenSample } from "./connections.js";
import { sheetKeysForLead } from "../services/sheets-writeback.js";

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
export async function getOrCreateLiveBatch(
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

  // Guard: stopped campaigns must not ingest or dispatch new leads.
  if (campaign.status === "stopped") {
    logger.info(
      { campaignId: opts.campaignId, source: opts.source, phone: opts.phone },
      "Webhook lead rejected — campaign is stopped",
    );
    throw new Error("Campaign is stopped and no longer accepting leads");
  }

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

  // Resolve the agent's IANA timezone for date-boundary decisions.
  let agentTimezone = campaign.timezone ?? "Asia/Kolkata";
  if (campaign.agentId) {
    const agent = await db.query.agentsTable.findFirst({
      where: eq(agentsTable.id, campaign.agentId),
      columns: { agentConfig: true },
    });
    const tz = (agent?.agentConfig as Record<string, unknown> | null)?.["timezone"];
    if (typeof tz === "string" && tz.length > 0) agentTimezone = tz;
  }

  // For webhook / Instagram-Ads leads: ALWAYS use getOrCreateLiveBatch so the
  // daily batch is keyed on TODAY's date in the agent's timezone.  We must NOT
  // use a runningBatch lookup here — that would pick up yesterday's still-running
  // batch and add new leads to the wrong date group.
  // CSV leads always arrive pre-assigned to a manually created batch — unchanged.
  const isWebhookSource = opts.source === "webhook" || opts.source === "instagram_ads";

  // Find the currently running batch for this campaign (non-webhook only).
  const runningBatch = isWebhookSource ? null : await db.query.campaignBatchesTable.findFirst({
    where: and(
      eq(campaignBatchesTable.campaignId, opts.campaignId),
      eq(campaignBatchesTable.status, "running"),
    ),
    orderBy: (t, { desc }) => [desc(t.id)],
  });

  const targetBatch = isWebhookSource
    ? await getOrCreateLiveBatch(opts.campaignId, agentTimezone)
    : runningBatch ?? null;

  const sheetKeys = await sheetKeysForLead(campaign.userId, campaign.agentId, opts.phone);
  const [lead] = await db.insert(campaignLeadsTable).values({
    campaignId:      opts.campaignId,
    batchId:         targetBatch?.id ?? null,
    phone:           opts.phone,
    normalizedPhone: normalized,
    name:            opts.name,
    email:           opts.email,
    leadData:        { ...opts.leadData, ...sheetKeys },
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

    // Gate dialing on campaign status and business hours.
    // If paused or outside calling hours: lead stays pending in the batch and the
    // batchScheduler's 60 s backstop will claim it once hours resume / campaign resumes.
    const isPaused = campaign.status === "paused";
    const inHours  = isWithinBusinessHours(campaign, agentTimezone);

    if (isPaused) {
      await db.update(campaignLeadsTable)
        .set({ callStatus: "queued" })
        .where(eq(campaignLeadsTable.id, lead!.id));
      logger.info(
        { campaignId: opts.campaignId, leadId: lead!.id, batchId: targetBatch.id },
        "Lead queued — campaign is paused; will dial when resumed",
      );
    } else if (!inHours) {
      await db.update(campaignLeadsTable)
        .set({ callStatus: "queued" })
        .where(eq(campaignLeadsTable.id, lead!.id));
      logger.info(
        { campaignId: opts.campaignId, leadId: lead!.id, batchId: targetBatch.id,
          businessHoursStart: campaign.businessHoursStart, businessHoursEnd: campaign.businessHoursEnd, tz: agentTimezone },
        "Lead queued — outside business hours; will dial when hours open",
      );
    } else {
      scheduleCampaignCall(lead!, campaign);
      logger.info(
        { campaignId: opts.campaignId, leadId: lead!.id, batchId: targetBatch.id, source: opts.source },
        "Webhook lead dispatched for immediate dial",
      );
    }
  } else {
    // No batch resolved (CSV lead with no running batch, or live-batch creation failed)
    logger.info(
      { campaignId: opts.campaignId, leadId: lead!.id },
      "Lead queued (batchId=null) — will dial when next batch starts",
    );
  }
}

/**
 * Returns true if the current time falls within the campaign's configured
 * calling window.  If no window is set (both nullable columns are null) every
 * hour is allowed.
 *
 * @param campaign   Must carry businessHoursStart / businessHoursEnd / timezone.
 * @param fallbackTz IANA timezone to use when campaign.timezone is absent.
 */
export function isWithinBusinessHours(
  campaign: {
    isCallingHoursEnabled?: boolean;
    businessHoursStart?:    number | null;
    businessHoursEnd?:      number | null;
    timezone?:              string | null;
  },
  fallbackTz: string,
): boolean {
  // When calling-hours toggle is OFF, ignore the schedule entirely (24/7)
  if (campaign.isCallingHoursEnabled === false) return true;

  const start = campaign.businessHoursStart;
  const end   = campaign.businessHoursEnd;
  if (start == null || end == null) return true; // no restriction — dial any time
  const tz = campaign.timezone ?? fallbackTz;
  // Convert "now" to a wall-clock Date in the target timezone.
  const nowLocal = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  // Backward-compat: legacy values were stored as whole hours (0–23).
  // New values are stored as minutes-since-midnight (≥ 24, e.g. 570 = 9:30 AM).
  const nowMinutes   = nowLocal.getHours() * 60 + nowLocal.getMinutes();
  const startMinutes = start < 24 ? start * 60 : start;
  const endMinutes   = end   < 24 ? end   * 60 : end;
  return startMinutes <= nowMinutes && nowMinutes < endMinutes;
}

/** Mark last webhook event on the campaign row (fire-and-forget, best-effort). */
function touchWebhookStatus(campaignId: number, status: "ok" | "error"): void {
  db.update(campaignsTable)
    .set({ lastWebhookAt: new Date(), lastWebhookStatus: status })
    .where(eq(campaignsTable.id, campaignId))
    .catch((err: unknown) => logger.warn({ err, campaignId }, "Failed to update webhook status"));
}

/**
 * Record a form/page-id validation failure on the campaign row.
 * Sets lastWebhookStatus="error" and persists the audit detail in lastValidationError.
 * Fire-and-forget — does not block the webhook response.
 */
function touchValidationError(campaignId: number, error: CampaignValidationError): void {
  db.update(campaignsTable)
    .set({ lastWebhookAt: new Date(), lastWebhookStatus: "error", lastValidationError: error })
    .where(eq(campaignsTable.id, campaignId))
    .catch((err: unknown) => logger.warn({ err, campaignId }, "Failed to persist validation error"));
}

/**
 * Clear any stored validation error after a fully-valid webhook is processed.
 * Fire-and-forget — does not block the webhook response.
 */
function clearValidationError(campaignId: number): void {
  db.update(campaignsTable)
    .set({ lastWebhookAt: new Date(), lastWebhookStatus: "ok", lastValidationError: null })
    .where(eq(campaignsTable.id, campaignId))
    .catch((err: unknown) => logger.warn({ err, campaignId }, "Failed to clear validation error"));
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
  // Meta always signs genuine leadgen webhook deliveries with X-Hub-Signature-256
  // (computed from the App Secret configured on the Meta app's webhook subscription).
  // A payload shaped like a Meta leadgen event ({object:"page", entry:[...]}) but with
  // NO verifiable signature is indistinguishable from a forged request by anyone who
  // has found/guessed this campaign's webhook URL — so for that shape we require a
  // signature to be configured and to verify, rather than silently trusting the body.
  const looksLikeMetaLeadgen = body["object"] === "page" && Array.isArray(body["entry"]);
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
  } else if (looksLikeMetaLeadgen) {
    logger.warn(
      { campaignId: campaign.id },
      "Meta leadgen-shaped payload rejected — no App Secret (hmacSecret) configured on this campaign to verify X-Hub-Signature-256",
    );
    touchWebhookStatus(campaign.id, "error");
    res.status(428).json({
      error: "This campaign has not configured a Meta App Secret. Set one under Campaign → Meta Integration before Instagram/Facebook leads can be accepted.",
    });
    return;
  }

  // ── Meta "Send to My Server" test ping ───────────────────────────────────
  // Meta's test button sends { "sample": { "field": "leadgen", ... } } with no
  // "object"/"entry" structure. Detect and acknowledge without creating a lead.
  if ((body as Record<string, unknown>)["sample"] !== undefined &&
      ((body as Record<string, unknown>)["sample"] as Record<string, unknown>)?.["field"] === "leadgen") {
    logger.info({ campaignId: campaign.id }, "Meta test ping received — not ingested as lead");
    touchWebhookStatus(campaign.id, "ok");
    res.json({ received: true, mode: "meta_test_ping" });
    return;
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
    let anyValidationFailed = false;
    let anyLeadAccepted     = false;

    for (const entry of body["entry"] as Array<Record<string, unknown>>) {
      const changes = Array.isArray(entry["changes"]) ? entry["changes"] : [];
      for (const change of changes as Array<Record<string, unknown>>) {
        if (change["field"] !== "leadgen") continue;

        const value = change["value"] as Record<string, unknown> | undefined;
        if (!value) continue;

        // ── Layer-2: source form/page validation ──────────────────────────
        // Validate that this webhook change belongs to the campaign's configured
        // Lead Form (and optionally Page). Reject the change if either mismatches.
        const incomingFormId = value["form_id"] != null ? String(value["form_id"]) : null;
        const incomingPageId = value["page_id"] != null ? String(value["page_id"]) : null;

        if (campaign.sourceFormId) {
          if (!incomingFormId || incomingFormId !== campaign.sourceFormId) {
            const err: CampaignValidationError = {
              receivedFormId: incomingFormId ?? "(missing)",
              expectedFormId: campaign.sourceFormId,
              receivedPageId: incomingPageId,
              expectedPageId: campaign.sourcePageId ?? null,
              webhookToken:   token,
              timestamp:      new Date().toISOString(),
              reason:         !incomingFormId
                ? "Meta webhook missing form_id"
                : `form_id mismatch — received: ${incomingFormId}, expected: ${campaign.sourceFormId}`,
            };
            logger.warn(
              { campaignId: campaign.id, ...err },
              "Meta form_id validation failed — lead rejected",
            );
            touchValidationError(campaign.id, err);
            anyValidationFailed = true;
            continue;
          }
        }

        // Optional page_id validation (only when both are configured and present)
        if (campaign.sourcePageId && incomingPageId && incomingPageId !== campaign.sourcePageId) {
          const err: CampaignValidationError = {
            receivedFormId: incomingFormId ?? "(missing)",
            expectedFormId: campaign.sourceFormId ?? null,
            receivedPageId: incomingPageId,
            expectedPageId: campaign.sourcePageId,
            webhookToken:   token,
            timestamp:      new Date().toISOString(),
            reason:         `page_id mismatch — received: ${incomingPageId}, expected: ${campaign.sourcePageId}`,
          };
          logger.warn(
            { campaignId: campaign.id, ...err },
            "Meta page_id validation failed — lead rejected",
          );
          touchValidationError(campaign.id, err);
          anyValidationFailed = true;
          continue;
        }
        // ── End of source validation ──────────────────────────────────────

        const leadgenId = String(value["leadgen_id"] ?? "");

        // ── Fetch lead field_data from Meta Graph API ─────────────────────
        // Meta webhooks only deliver a notification (leadgen_id + form_id).
        // The actual field values (phone, name, email) must be retrieved via
        // a separate Graph API call using the campaign's Page Access Token.
        let fieldData: Array<{ name: string; values: string[] }> = [];

        // First try: in-payload field_data (older Meta apps / some test tools send it)
        if (Array.isArray(value["field_data"])) {
          fieldData = value["field_data"] as Array<{ name: string; values: string[] }>;
        } else if (leadgenId && campaign.metaPageAccessToken) {
          // Standard path: fetch from Graph API
          try {
            const pageToken = decryptKey(campaign.metaPageAccessToken);
            const graphUrl  = `https://graph.facebook.com/v20.0/${leadgenId}?fields=field_data&access_token=${encodeURIComponent(pageToken)}`;
            const gRes      = await fetch(graphUrl, { signal: AbortSignal.timeout(8000) });
            if (gRes.ok) {
              const gData = await gRes.json() as { field_data?: Array<{ name: string; values: string[] }> };
              fieldData = gData.field_data ?? [];
            } else {
              const errBody = await gRes.text();
              logger.warn({ campaignId: campaign.id, leadgenId, status: gRes.status, errBody },
                "Meta Graph API fetch failed — lead skipped");
              continue;
            }
          } catch (fetchErr) {
            logger.warn({ campaignId: campaign.id, leadgenId, fetchErr },
              "Meta Graph API request error — lead skipped");
            continue;
          }
        } else if (leadgenId && !campaign.metaPageAccessToken) {
          logger.warn({ campaignId: campaign.id, leadgenId },
            "Meta lead received but no Page Access Token configured — set it in Campaign → Meta Integration");
          continue;
        }
        // ── End Graph API fetch ───────────────────────────────────────────

        // Convert Meta field_data array → flat map
        const metaFlat: Record<string, string> = {};
        for (const fd of fieldData) {
          metaFlat[fd.name] = fd.values?.[0] ?? "";
        }

        // Remap Meta's standard field names to the generic keys extractLeadFields expects
        if (!("phone" in metaFlat) && "phone_number" in metaFlat) metaFlat["phone"] = metaFlat["phone_number"]!;
        if (!("name"  in metaFlat) && "full_name"    in metaFlat) metaFlat["name"]  = metaFlat["full_name"]!;

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

        anyLeadAccepted = true;
      }
    }

    // Clear stored validation error only when at least one lead was accepted with
    // no failures in this batch (i.e. config is now correct).
    if (anyLeadAccepted && !anyValidationFailed) {
      clearValidationError(campaign.id);
    } else if (!anyValidationFailed) {
      touchWebhookStatus(campaign.id, "ok");
    }
    // If anyValidationFailed=true, touchValidationError already persisted the error.

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

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
 */

import { Router, type IRouter } from "express";
import { db, campaignsTable, campaignLeadsTable, leadTimelineTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { scheduleCampaignCall } from "../orchestration/campaignCaller.js";
import { normalizePhone } from "../lib/phone-normalize.js";
import { isOnDnc } from "../lib/dnc-check.js";

const router: IRouter = Router();

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

  if (!campaign || !campaign.isActive) {
    logger.info({ campaignId: opts.campaignId }, "Campaign not active — lead dropped");
    return;
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

  const [lead] = await db.insert(campaignLeadsTable).values({
    campaignId:      opts.campaignId,
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
    leadId:    lead!.id,
    campaignId: opts.campaignId,
    eventType: "imported",
    data:      { source: opts.source, externalLeadId: opts.externalLeadId ?? null },
  });

  // Increment totalLeads counter
  await db.update(campaignsTable)
    .set({ totalLeads: sql`${campaignsTable.totalLeads} + 1` })
    .where(eq(campaignsTable.id, opts.campaignId));

  scheduleCampaignCall(lead!, campaign);
}

// ── GET /api/webhooks/lead/:token — Instagram Meta verification ────────────
router.get("/webhooks/lead/:token", (req, res): void => {
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
router.post("/webhooks/lead/:token", async (req, res): Promise<void> => {
  const token = req.params["token"];

  // Look up campaign by webhook token
  const campaign = await db.query.campaignsTable.findFirst({
    where: eq(campaignsTable.webhookToken, token!),
  });

  if (!campaign) {
    res.status(404).json({ error: "Unknown webhook token" });
    return;
  }

  const body = req.body as Record<string, unknown>;

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
        const flat: Record<string, string> = {};
        for (const fd of fieldData as Array<{ name: string; values: string[] }>) {
          flat[fd.name] = fd.values?.[0] ?? "";
        }

        const { phone, name, email, leadData } = extractLeadFields(flat, campaign.fieldMappings as Record<string, string>);

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

    res.json({ received: true });
    return;
  }

  // ── Generic website / form webhook ──────────────────────────────────────
  const flat = flattenObject(body);
  const { phone, name, email, leadData } = extractLeadFields(flat, campaign.fieldMappings as Record<string, string>);

  if (!phone) {
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

  res.json({ received: true, phone });
});

export default router;

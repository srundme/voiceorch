/**
 * Campaign lead transfer — after a campaign call ends, if the disposition
 * matches the campaign's selected list, push lead+call data to a webhook
 * (any CRM via Zapier/Make/n8n) or append a Google Sheets row.
 */
import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  campaignsTable,
  campaignLeadsTable,
  callsTable,
  agentsTable,
  type CampaignLeadTransferConfig,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { appendCallLogRow } from "./google-sheets.js";

const TRANSFER_SENT_KEY = "__leadTransferCallId";

export function parseLeadTransferConfig(raw: unknown): CampaignLeadTransferConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o["enabled"] !== true) return null;
  const dispositions = Array.isArray(o["dispositions"])
    ? o["dispositions"]
        .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
        .map((d) => d.trim())
    : [];
  if (!dispositions.length) return null;
  const destination = o["destination"] === "google_sheets" ? "google_sheets" : "webhook";
  const cfg: CampaignLeadTransferConfig = {
    enabled: true,
    dispositions,
    destination,
  };
  if (typeof o["webhookUrl"] === "string" && o["webhookUrl"].trim()) {
    cfg.webhookUrl = o["webhookUrl"].trim();
  }
  if (typeof o["webhookSecret"] === "string" && o["webhookSecret"].trim()) {
    cfg.webhookSecret = o["webhookSecret"].trim();
  }
  if (typeof o["connectionId"] === "string" && o["connectionId"].trim()) {
    cfg.connectionId = o["connectionId"].trim();
  }
  if (typeof o["spreadsheetId"] === "string" && o["spreadsheetId"].trim()) {
    cfg.spreadsheetId = o["spreadsheetId"].trim();
  }
  if (typeof o["sheetName"] === "string" && o["sheetName"].trim()) {
    cfg.sheetName = o["sheetName"].trim();
  }
  if (destination === "webhook" && !cfg.webhookUrl?.startsWith("https://")) return null;
  if (
    destination === "google_sheets" &&
    (!cfg.connectionId || !cfg.spreadsheetId)
  ) {
    return null;
  }
  return cfg;
}

/** Normalize config from API create/update (may be disabled). */
export function normalizeLeadTransferInput(raw: unknown): CampaignLeadTransferConfig | null {
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o["enabled"] !== true) {
    return { enabled: false, dispositions: [], destination: "webhook" };
  }
  const parsed = parseLeadTransferConfig({ ...o, enabled: true });
  if (!parsed) {
    // Keep enabled flag but incomplete — treat as disabled for safety.
    return { enabled: false, dispositions: [], destination: "webhook" };
  }
  return parsed;
}

export function dispositionMatchesTransfer(
  dispositionResult: Record<string, unknown> | null | undefined,
  selected: string[],
): boolean {
  if (!selected.length) return false;
  const needles = selected.map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!needles.length) return false;

  const candidates = new Set<string>();
  if (!dispositionResult || typeof dispositionResult !== "object") return false;

  const primary =
    typeof dispositionResult["primary"] === "string" ? dispositionResult["primary"].trim() : "";
  const sub = typeof dispositionResult["sub"] === "string" ? dispositionResult["sub"].trim() : "";
  if (primary) {
    candidates.add(primary.toLowerCase());
    if (sub) candidates.add(`${primary}:${sub}`.toLowerCase());
  }
  // Legacy / flat schemas: any string field value
  for (const [k, v] of Object.entries(dispositionResult)) {
    if (typeof v === "string" && v.trim()) {
      candidates.add(v.trim().toLowerCase());
      candidates.add(`${k}:${v.trim()}`.toLowerCase());
    }
  }

  return needles.some((n) => candidates.has(n));
}

function formatDispositionLabel(disp: Record<string, unknown> | null): string {
  if (!disp) return "";
  const primary = typeof disp["primary"] === "string" ? disp["primary"] : "";
  const sub = typeof disp["sub"] === "string" ? disp["sub"] : "";
  if (primary && sub) return `${primary}: ${sub}`;
  if (primary) return primary;
  try {
    return JSON.stringify(disp).slice(0, 200);
  } catch {
    return "";
  }
}

/**
 * Fire-and-forget safe entry: resolve campaign lead, match disposition, send once.
 */
export async function maybeTransferCampaignLead(opts: {
  callId: number;
  campaignLeadId?: number | null;
  dispositionResult?: Record<string, unknown> | null;
  callSummary?: string | null;
}): Promise<{ transferred: boolean; reason?: string }> {
  const callId = opts.callId;
  let lead =
    typeof opts.campaignLeadId === "number" && opts.campaignLeadId > 0
      ? (
          await db
            .select()
            .from(campaignLeadsTable)
            .where(eq(campaignLeadsTable.id, opts.campaignLeadId))
            .limit(1)
        )[0] ?? null
      : null;

  if (!lead) {
    lead =
      (
        await db
          .select()
          .from(campaignLeadsTable)
          .where(eq(campaignLeadsTable.callId, callId))
          .limit(1)
      )[0] ?? null;
  }
  if (!lead) return { transferred: false, reason: "no_campaign_lead" };

  const leadData = (lead.leadData ?? {}) as Record<string, string>;
  if (leadData[TRANSFER_SENT_KEY] === String(callId)) {
    return { transferred: false, reason: "already_sent" };
  }

  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, lead.campaignId))
    .limit(1);
  if (!campaign) return { transferred: false, reason: "campaign_missing" };

  const cfg = parseLeadTransferConfig(campaign.leadTransfer);
  if (!cfg) return { transferred: false, reason: "transfer_disabled" };

  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, callId)).limit(1);
  const dispositionResult =
    opts.dispositionResult ??
    (call?.dispositionResult as Record<string, unknown> | null) ??
    null;

  if (!dispositionMatchesTransfer(dispositionResult, cfg.dispositions)) {
    return { transferred: false, reason: "disposition_mismatch" };
  }

  // Mark early to reduce double-send races (session + PATCH /calls/:id/end).
  const nextLeadData: Record<string, string> = {
    ...leadData,
    [TRANSFER_SENT_KEY]: String(callId),
    __leadTransferAt: new Date().toISOString(),
    __leadTransferDest: cfg.destination,
  };
  const dispLabel = formatDispositionLabel(dispositionResult);
  await db
    .update(campaignLeadsTable)
    .set({
      leadData: nextLeadData,
      ...(dispLabel ? { disposition: dispLabel.slice(0, 200) } : {}),
    })
    .where(
      and(eq(campaignLeadsTable.id, lead.id), eq(campaignLeadsTable.campaignId, lead.campaignId)),
    );

  const [agent] = campaign.agentId
    ? await db
        .select({ id: agentsTable.id, name: agentsTable.name })
        .from(agentsTable)
        .where(eq(agentsTable.id, campaign.agentId))
        .limit(1)
    : [null];

  const summary = opts.callSummary ?? call?.callSummary ?? null;
  const payload = {
    event: "campaign.lead_transferred",
    campaignId: campaign.id,
    campaignName: campaign.name,
    leadId: lead.id,
    callId,
    phone: lead.phone,
    name: lead.name ?? null,
    email: lead.email ?? null,
    leadData: Object.fromEntries(
      Object.entries(leadData).filter(([k]) => !k.startsWith("__")),
    ),
    disposition: dispLabel || null,
    dispositionResult,
    callSummary: summary,
    recordingUrl: call?.recordingUrl ?? null,
    durationSeconds: call?.durationSeconds ?? null,
    agentId: agent?.id ?? campaign.agentId ?? null,
    agentName: agent?.name ?? null,
    transferredAt: new Date().toISOString(),
  };

  try {
    if (cfg.destination === "webhook") {
      await sendTransferWebhook(cfg, payload);
    } else {
      await sendTransferSheet(campaign.userId, cfg, payload);
    }
    logger.info(
      {
        campaignId: campaign.id,
        leadId: lead.id,
        callId,
        destination: cfg.destination,
        disposition: dispLabel,
      },
      "Campaign lead transferred",
    );
    return { transferred: true };
  } catch (err) {
    // Allow a later retry path by clearing the sentinel on hard failure.
    try {
      const { [TRANSFER_SENT_KEY]: _drop, __leadTransferAt: _a, __leadTransferDest: _d, ...rest } =
        nextLeadData;
      await db
        .update(campaignLeadsTable)
        .set({ leadData: rest })
        .where(eq(campaignLeadsTable.id, lead.id));
    } catch {
      /* ignore */
    }
    logger.warn({ err, campaignId: campaign.id, leadId: lead.id, callId }, "Campaign lead transfer failed");
    return { transferred: false, reason: "send_failed" };
  }
}

async function sendTransferWebhook(
  cfg: CampaignLeadTransferConfig,
  payload: Record<string, unknown>,
): Promise<void> {
  const url = cfg.webhookUrl!;
  const bodyStr = JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.webhookSecret) {
    const sig =
      "sha256=" + createHmac("sha256", cfg.webhookSecret).update(bodyStr, "utf8").digest("hex");
    headers["X-SnapServe-Signature"] = sig;
    headers["X-VoiceOrch-Signature"] = sig;
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: bodyStr,
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`webhook ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function sendTransferSheet(
  userId: string,
  cfg: CampaignLeadTransferConfig,
  payload: {
    phone: string;
    name: string | null;
    email: string | null;
    disposition: string | null;
    callSummary: string | null;
    callId: number;
    campaignId: number;
    leadId: number;
    recordingUrl: string | null;
    transferredAt: string;
    agentName: string | null;
  },
): Promise<void> {
  const fields: Record<string, string | number | null | undefined> = {
    phone: payload.phone,
    name: payload.name ?? "",
    email: payload.email ?? "",
    disposition: payload.disposition ?? "",
    notes: payload.callSummary ?? "",
    status: payload.disposition ?? "transferred",
    lastCallAt: payload.transferredAt,
    callId: payload.callId,
    campaignId: payload.campaignId,
    leadId: payload.leadId,
    recordingUrl: payload.recordingUrl ?? "",
    agentName: payload.agentName ?? "",
  };
  await appendCallLogRow(
    userId,
    cfg.connectionId!,
    cfg.spreadsheetId!,
    cfg.sheetName?.trim() || "Sheet1",
    fields,
    {
      phone: "Phone",
      name: "Name",
      email: "Email",
      disposition: "Disposition",
      notes: "Notes",
      status: "Status",
      lastCallAt: "Last Call At",
      callId: "Call ID",
      campaignId: "Campaign ID",
      leadId: "Lead ID",
      recordingUrl: "Recording URL",
      agentName: "Agent",
    },
  );
}

/**
 * Campaign lead transfer — after a campaign call ends, if the disposition
 * matches a rule, push lead+call data to a webhook or Google Sheets row.
 * Supports multiple rules, field maps, and replay of past matches.
 */
import { createHmac, randomUUID } from "node:crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  db,
  campaignsTable,
  campaignLeadsTable,
  callsTable,
  agentsTable,
  type CampaignLeadTransferConfig,
  type CampaignLeadTransferRule,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { fetchUserConfiguredUrl } from "../lib/ssrf.js";
import { appendCallLogRow } from "./google-sheets.js";
import {
  dispositionMatchesAny,
  formatDispositionLabel,
} from "../lib/disposition-match.js";

const TRANSFER_SENT_KEY = "__leadTransferCallId";
const RULE_SENT_PREFIX = "__leadTransferRule_";

function ruleSentKey(ruleId: string): string {
  return `${RULE_SENT_PREFIX}${ruleId}`;
}

function parseRule(raw: unknown, fallbackId?: string): CampaignLeadTransferRule | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const dispositions = Array.isArray(o["dispositions"])
    ? o["dispositions"]
        .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
        .map((d) => d.trim())
    : [];
  if (!dispositions.length) return null;
  const destination = o["destination"] === "google_sheets" ? "google_sheets" : "webhook";
  const rule: CampaignLeadTransferRule = {
    id:
      typeof o["id"] === "string" && o["id"].trim()
        ? o["id"].trim()
        : fallbackId ?? randomUUID(),
    dispositions,
    destination,
  };
  if (typeof o["name"] === "string" && o["name"].trim()) rule.name = o["name"].trim();
  if (typeof o["webhookUrl"] === "string" && o["webhookUrl"].trim()) {
    rule.webhookUrl = o["webhookUrl"].trim();
  }
  if (typeof o["webhookSecret"] === "string" && o["webhookSecret"].trim()) {
    rule.webhookSecret = o["webhookSecret"].trim();
  }
  if (typeof o["connectionId"] === "string" && o["connectionId"].trim()) {
    rule.connectionId = o["connectionId"].trim();
  }
  if (typeof o["spreadsheetId"] === "string" && o["spreadsheetId"].trim()) {
    rule.spreadsheetId = o["spreadsheetId"].trim();
  }
  if (typeof o["sheetName"] === "string" && o["sheetName"].trim()) {
    rule.sheetName = o["sheetName"].trim();
  }
  if (o["fieldMap"] && typeof o["fieldMap"] === "object" && !Array.isArray(o["fieldMap"])) {
    const fm: Record<string, string> = {};
    for (const [k, v] of Object.entries(o["fieldMap"] as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim() && k.trim()) fm[k.trim()] = v.trim();
    }
    if (Object.keys(fm).length) rule.fieldMap = fm;
  }
  if (destination === "webhook" && !rule.webhookUrl?.startsWith("https://")) return null;
  if (destination === "google_sheets" && (!rule.connectionId || !rule.spreadsheetId)) return null;
  return rule;
}

/** Expand config into executable rules (legacy top-level → single rule). */
export function expandLeadTransferRules(
  cfg: CampaignLeadTransferConfig | null,
): CampaignLeadTransferRule[] {
  if (!cfg?.enabled) return [];
  if (Array.isArray(cfg.rules) && cfg.rules.length) {
    return cfg.rules
      .map((r, i) => parseRule(r, `legacy_${i}`))
      .filter((r): r is CampaignLeadTransferRule => !!r);
  }
  // Legacy single-rule shape
  const legacy = parseRule(
    {
      id: "default",
      dispositions: cfg.dispositions ?? [],
      destination: cfg.destination ?? "webhook",
      webhookUrl: cfg.webhookUrl,
      webhookSecret: cfg.webhookSecret,
      connectionId: cfg.connectionId,
      spreadsheetId: cfg.spreadsheetId,
      sheetName: cfg.sheetName,
      fieldMap: cfg.fieldMap,
    },
    "default",
  );
  return legacy ? [legacy] : [];
}

export function parseLeadTransferConfig(raw: unknown): CampaignLeadTransferConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o["enabled"] !== true) return null;

  const rulesFromArr = Array.isArray(o["rules"])
    ? o["rules"]
        .map((r, i) => parseRule(r, `rule_${i}`))
        .filter((r): r is CampaignLeadTransferRule => !!r)
    : [];

  if (rulesFromArr.length) {
    return { enabled: true, rules: rulesFromArr };
  }

  const legacy = parseRule({ ...o, id: "default" }, "default");
  if (!legacy) return null;
  return {
    enabled: true,
    rules: [legacy],
    // Keep flat fields for clients that still read the legacy shape
    dispositions: legacy.dispositions,
    destination: legacy.destination,
    webhookUrl: legacy.webhookUrl,
    webhookSecret: legacy.webhookSecret,
    connectionId: legacy.connectionId,
    spreadsheetId: legacy.spreadsheetId,
    sheetName: legacy.sheetName,
    fieldMap: legacy.fieldMap,
  };
}

/** Normalize config from API create/update (may be disabled). */
export function normalizeLeadTransferInput(raw: unknown): CampaignLeadTransferConfig | null {
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o["enabled"] !== true) {
    return { enabled: false, dispositions: [], destination: "webhook", rules: [] };
  }
  const parsed = parseLeadTransferConfig({ ...o, enabled: true });
  if (!parsed) {
    return { enabled: false, dispositions: [], destination: "webhook", rules: [] };
  }
  return parsed;
}

/** @deprecated Use dispositionMatchesAny — kept for existing imports. */
export function dispositionMatchesTransfer(
  dispositionResult: Record<string, unknown> | null | undefined,
  selected: string[],
): boolean {
  return dispositionMatchesAny(dispositionResult, selected);
}

function applyFieldMap(
  base: Record<string, string | number | null | undefined>,
  fieldMap?: Record<string, string>,
): Record<string, string | number | null | undefined> {
  if (!fieldMap || !Object.keys(fieldMap).length) return base;
  const out: Record<string, string | number | null | undefined> = {};
  for (const [src, dest] of Object.entries(fieldMap)) {
    if (src in base) out[dest] = base[src];
  }
  // Always keep unmapped core keys under original names when not remapped
  for (const [k, v] of Object.entries(base)) {
    const remapped = Object.prototype.hasOwnProperty.call(fieldMap, k);
    if (!remapped && !(k in out)) out[k] = v;
  }
  return out;
}

function alreadySentForRule(
  leadData: Record<string, string>,
  ruleId: string,
  callId: number,
): boolean {
  if (leadData[ruleSentKey(ruleId)] === String(callId)) return true;
  // Legacy single-rule sentinel
  if (ruleId === "default" && leadData[TRANSFER_SENT_KEY] === String(callId)) return true;
  return false;
}

/**
 * Fire-and-forget safe entry: resolve campaign lead, match disposition rules, send once per rule.
 */
export async function maybeTransferCampaignLead(opts: {
  callId: number;
  campaignLeadId?: number | null;
  dispositionResult?: Record<string, unknown> | null;
  callSummary?: string | null;
  /** When true, ignore per-rule sent sentinels (replay). */
  force?: boolean;
  /** Limit to specific rule ids. */
  ruleIds?: string[];
}): Promise<{ transferred: boolean; ruleIds: string[]; reason?: string }> {
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
  if (!lead) return { transferred: false, ruleIds: [], reason: "no_campaign_lead" };

  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, lead.campaignId))
    .limit(1);
  if (!campaign) return { transferred: false, ruleIds: [], reason: "campaign_missing" };

  const cfg = parseLeadTransferConfig(campaign.leadTransfer);
  if (!cfg) return { transferred: false, ruleIds: [], reason: "transfer_disabled" };

  let rules = expandLeadTransferRules(cfg);
  if (opts.ruleIds?.length) {
    const allow = new Set(opts.ruleIds);
    rules = rules.filter((r) => allow.has(r.id));
  }
  if (!rules.length) return { transferred: false, ruleIds: [], reason: "no_rules" };

  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, callId)).limit(1);
  const dispositionResult =
    opts.dispositionResult ??
    (call?.dispositionResult as Record<string, unknown> | null) ??
    null;
  const legacyLabel = lead.disposition ?? null;

  const matching = rules.filter((r) =>
    dispositionMatchesAny(dispositionResult, r.dispositions, legacyLabel),
  );
  if (!matching.length) {
    return { transferred: false, ruleIds: [], reason: "disposition_mismatch" };
  }

  const leadData = { ...((lead.leadData ?? {}) as Record<string, string>) };
  const toRun = matching.filter(
    (r) => opts.force || !alreadySentForRule(leadData, r.id, callId),
  );
  if (!toRun.length) return { transferred: false, ruleIds: [], reason: "already_sent" };

  const [agent] = campaign.agentId
    ? await db
        .select({ id: agentsTable.id, name: agentsTable.name })
        .from(agentsTable)
        .where(eq(agentsTable.id, campaign.agentId))
        .limit(1)
    : [null];

  const summary = opts.callSummary ?? call?.callSummary ?? null;
  const dispLabel = formatDispositionLabel(dispositionResult) || legacyLabel || "";
  const cleanLeadData = Object.fromEntries(
    Object.entries(leadData).filter(([k]) => !k.startsWith("__")),
  );

  const sentRuleIds: string[] = [];
  let nextLeadData = { ...leadData };

  for (const rule of toRun) {
    // Mark early to reduce double-send races
    nextLeadData = {
      ...nextLeadData,
      [ruleSentKey(rule.id)]: String(callId),
      [TRANSFER_SENT_KEY]: String(callId),
      __leadTransferAt: new Date().toISOString(),
      __leadTransferDest: rule.destination,
      __leadTransferRuleId: rule.id,
    };
    await db
      .update(campaignLeadsTable)
      .set({
        leadData: nextLeadData,
        ...(dispLabel ? { disposition: dispLabel.slice(0, 200) } : {}),
      })
      .where(
        and(eq(campaignLeadsTable.id, lead.id), eq(campaignLeadsTable.campaignId, lead.campaignId)),
      );

    const coreFields: Record<string, string | number | null | undefined> = {
      phone: lead.phone,
      name: lead.name ?? "",
      email: lead.email ?? "",
      disposition: dispLabel || null,
      notes: summary ?? "",
      status: dispLabel || "transferred",
      lastCallAt: new Date().toISOString(),
      callId,
      campaignId: campaign.id,
      leadId: lead.id,
      recordingUrl: call?.recordingUrl ?? "",
      agentName: agent?.name ?? "",
      ...cleanLeadData,
    };
    const mapped = applyFieldMap(coreFields, rule.fieldMap);

    const payload = {
      event: "campaign.lead_transferred",
      ruleId: rule.id,
      ruleName: rule.name ?? null,
      campaignId: campaign.id,
      campaignName: campaign.name,
      leadId: lead.id,
      callId,
      phone: lead.phone,
      name: lead.name ?? null,
      email: lead.email ?? null,
      leadData: cleanLeadData,
      fields: mapped,
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
      if (rule.destination === "webhook") {
        await sendTransferWebhook(rule, payload);
      } else {
        await sendTransferSheet(campaign.userId, rule, mapped, payload);
      }
      sentRuleIds.push(rule.id);
      logger.info(
        {
          campaignId: campaign.id,
          leadId: lead.id,
          callId,
          ruleId: rule.id,
          destination: rule.destination,
          disposition: dispLabel,
        },
        "Campaign lead transferred",
      );
    } catch (err) {
      // Clear this rule's sentinel on hard failure so retry/replay can work
      try {
        const cleared = { ...nextLeadData };
        delete cleared[ruleSentKey(rule.id)];
        if (rule.id === "default") delete cleared[TRANSFER_SENT_KEY];
        await db
          .update(campaignLeadsTable)
          .set({ leadData: cleared })
          .where(eq(campaignLeadsTable.id, lead.id));
        nextLeadData = cleared;
      } catch {
        /* ignore */
      }
      logger.warn(
        { err, campaignId: campaign.id, leadId: lead.id, callId, ruleId: rule.id },
        "Campaign lead transfer failed",
      );
    }
  }

  return {
    transferred: sentRuleIds.length > 0,
    ruleIds: sentRuleIds,
    reason: sentRuleIds.length ? undefined : "send_failed",
  };
}

/**
 * Replay transfer for past campaign leads whose disposition matches current rules.
 */
export async function replayCampaignLeadTransfers(opts: {
  campaignId: number;
  userId: string;
  force?: boolean;
  limit?: number;
  dispositions?: string[];
}): Promise<{ scanned: number; transferred: number; skipped: number; errors: number }> {
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(
      and(eq(campaignsTable.id, opts.campaignId), eq(campaignsTable.userId, opts.userId)),
    )
    .limit(1);
  if (!campaign) return { scanned: 0, transferred: 0, skipped: 0, errors: 0 };

  const cfg = parseLeadTransferConfig(campaign.leadTransfer);
  const rules = expandLeadTransferRules(cfg);
  if (!rules.length) return { scanned: 0, transferred: 0, skipped: 0, errors: 0 };

  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const leads = await db
    .select()
    .from(campaignLeadsTable)
    .where(
      and(
        eq(campaignLeadsTable.campaignId, opts.campaignId),
        isNotNull(campaignLeadsTable.callId),
        isNotNull(campaignLeadsTable.disposition),
      ),
    )
    .orderBy(sql`${campaignLeadsTable.id} desc`)
    .limit(limit);

  let transferred = 0;
  let skipped = 0;
  let errors = 0;

  for (const lead of leads) {
    if (!lead.callId) {
      skipped++;
      continue;
    }
    const [call] = await db
      .select({ dispositionResult: callsTable.dispositionResult, callSummary: callsTable.callSummary })
      .from(callsTable)
      .where(eq(callsTable.id, lead.callId))
      .limit(1);
    const dispositionResult = (call?.dispositionResult as Record<string, unknown> | null) ?? null;
    const matchRules = rules.filter((r) => {
      if (opts.dispositions?.length) {
        const overlap = r.dispositions.some((d) =>
          opts.dispositions!.some((x) => x.toLowerCase() === d.toLowerCase()),
        );
        if (!overlap && !dispositionMatchesAny(dispositionResult, opts.dispositions, lead.disposition)) {
          return false;
        }
      }
      return dispositionMatchesAny(dispositionResult, r.dispositions, lead.disposition);
    });
    if (!matchRules.length) {
      skipped++;
      continue;
    }
    try {
      const result = await maybeTransferCampaignLead({
        callId: lead.callId,
        campaignLeadId: lead.id,
        dispositionResult,
        callSummary: call?.callSummary ?? null,
        force: opts.force === true,
        ruleIds: matchRules.map((r) => r.id),
      });
      if (result.transferred) transferred++;
      else skipped++;
    } catch {
      errors++;
    }
  }

  return { scanned: leads.length, transferred, skipped, errors };
}

async function sendTransferWebhook(
  rule: CampaignLeadTransferRule,
  payload: Record<string, unknown>,
): Promise<void> {
  const url = rule.webhookUrl!;
  const bodyStr = JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (rule.webhookSecret) {
    const sig =
      "sha256=" + createHmac("sha256", rule.webhookSecret).update(bodyStr, "utf8").digest("hex");
    headers["X-SnapServe-Signature"] = sig;
    headers["X-VoiceOrch-Signature"] = sig;
  }
  const res = await fetchUserConfiguredUrl(url, {
    method: "POST",
    headers,
    body: bodyStr,
  }, { timeoutMs: 12_000, retries: 2 });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`webhook ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function sendTransferSheet(
  userId: string,
  rule: CampaignLeadTransferRule,
  fields: Record<string, string | number | null | undefined>,
  payload: { transferredAt: string },
): Promise<void> {
  const defaultHeaders: Record<string, string> = {
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
  };
  // fieldMap values are destination column names; keys are SnapServe fields
  const columnMap: Record<string, string> = { ...defaultHeaders };
  if (rule.fieldMap) {
    for (const [src, dest] of Object.entries(rule.fieldMap)) {
      columnMap[src] = dest;
      // Mapped payload may already use dest keys
      columnMap[dest] = dest;
    }
  }
  const sheetFields = {
    ...fields,
    lastCallAt: fields["lastCallAt"] ?? payload.transferredAt,
  };
  await appendCallLogRow(
    userId,
    rule.connectionId!,
    rule.spreadsheetId!,
    rule.sheetName?.trim() || "Sheet1",
    sheetFields,
    columnMap,
  );
}

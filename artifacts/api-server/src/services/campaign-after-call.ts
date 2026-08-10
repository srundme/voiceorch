/**
 * Legacy campaign after-call branches — webhook only.
 * WhatsApp / email are owned by the agent (see agent-after-call-messages).
 */
import { eq } from "drizzle-orm";
import {
  db,
  campaignsTable,
  campaignLeadsTable,
  callsTable,
  type AfterCallBranch,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { dispositionMatchesAny, formatDispositionLabel } from "../lib/disposition-match.js";

export function parseAfterCallBranches(raw: unknown): AfterCallBranch[] {
  if (!Array.isArray(raw)) return [];
  const out: AfterCallBranch[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o["id"] === "string" && o["id"].trim() ? o["id"].trim() : cryptoRandomId();
    const dispositions = Array.isArray(o["dispositions"])
      ? o["dispositions"]
          .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
          .map((d) => d.trim())
      : [];
    const actionsRaw = Array.isArray(o["actions"]) ? o["actions"] : [];
    const actions = actionsRaw.filter(
      (a): a is "whatsapp" | "email" | "webhook" =>
        a === "whatsapp" || a === "email" || a === "webhook",
    );
    if (!dispositions.length || !actions.length) continue;
    const branch: AfterCallBranch = { id, dispositions, actions };
    if (typeof o["webhookUrl"] === "string" && o["webhookUrl"].trim().startsWith("https://")) {
      branch.webhookUrl = o["webhookUrl"].trim();
    }
    if (actions.includes("webhook") && !branch.webhookUrl) continue;
    out.push(branch);
  }
  return out;
}

export function normalizeAfterCallBranchesInput(raw: unknown): AfterCallBranch[] | null {
  if (raw === null || raw === undefined) return null;
  return parseAfterCallBranches(raw);
}

function cryptoRandomId(): string {
  return `br_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Run matching after-call webhook branches (legacy). Messaging is never gated here.
 * Always returns `{ gated: false }` so agent rules / legacy WhatsApp own messaging.
 */
export async function maybeRunAfterCallBranches(opts: {
  callId: number;
  campaignLeadId?: number | null;
  dispositionResult?: Record<string, unknown> | null;
  callSummary?: string | null;
}): Promise<{ gated: boolean; ran: string[]; reason?: string }> {
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
          .where(eq(campaignLeadsTable.callId, opts.callId))
          .limit(1)
      )[0] ?? null;
  }
  if (!lead) return { gated: false, ran: [], reason: "no_campaign_lead" };

  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, lead.campaignId))
    .limit(1);
  if (!campaign) return { gated: false, ran: [], reason: "campaign_missing" };

  const branches = parseAfterCallBranches(campaign.afterCallBranches);
  if (!branches.length) return { gated: false, ran: [], reason: "no_branches" };

  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, opts.callId)).limit(1);
  const dispositionResult =
    opts.dispositionResult ??
    (call?.dispositionResult as Record<string, unknown> | null) ??
    null;
  const legacyLabel = lead.disposition ?? null;

  const matching = branches.filter((b) =>
    dispositionMatchesAny(dispositionResult, b.dispositions, legacyLabel),
  );
  if (!matching.length) {
    return { gated: false, ran: [], reason: "no_matching_branch" };
  }

  const ran: string[] = [];
  const webhookBranches = matching.filter((b) => b.actions.includes("webhook") && b.webhookUrl);

  for (const br of webhookBranches) {
    try {
      const payload = {
        event: "campaign.after_call_branch",
        branchId: br.id,
        campaignId: campaign.id,
        campaignName: campaign.name,
        leadId: lead.id,
        callId: opts.callId,
        phone: lead.phone,
        name: lead.name,
        email: lead.email,
        disposition: formatDispositionLabel(dispositionResult) || legacyLabel,
        dispositionResult,
        callSummary: opts.callSummary ?? call?.callSummary ?? null,
        firedAt: new Date().toISOString(),
      };
      const bodyStr = JSON.stringify(payload);
      const res = await fetch(br.webhookUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bodyStr,
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`webhook ${res.status}: ${text.slice(0, 200)}`);
      }
      ran.push(`webhook:${br.id}`);
    } catch (err) {
      logger.warn({ err, callId: opts.callId, branchId: br.id }, "After-call webhook branch failed");
    }
  }

  logger.info(
    { campaignId: campaign.id, leadId: lead.id, callId: opts.callId, ran },
    "After-call webhook branches executed",
  );
  return { gated: false, ran };
}

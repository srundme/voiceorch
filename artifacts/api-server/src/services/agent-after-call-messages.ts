/**
 * Agent-owned after-call WhatsApp / email (universal + disposition rules).
 * Campaigns own CRM/Sheets lead transfer only — not messaging.
 */
import { eq } from "drizzle-orm";
import {
  db,
  agentDispositionsTable,
  agentsTable,
  callsTable,
  campaignLeadsTable,
  type AgentAfterCallMessages,
  EMPTY_AFTER_CALL_MESSAGES,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { dispositionMatchesAny, formatDispositionLabel } from "../lib/disposition-match.js";
import { dispatchWhatsappCallEnded } from "./whatsapp/outbound.js";
import { sendChannelEmail } from "./email-channel.js";

export function parseAfterCallMessages(raw: unknown): AgentAfterCallMessages | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const universalRaw = o["universal"];
  const universal =
    universalRaw && typeof universalRaw === "object"
      ? {
          whatsapp: !!(universalRaw as Record<string, unknown>)["whatsapp"],
          email: !!(universalRaw as Record<string, unknown>)["email"],
          whatsappTemplate: parseTemplate((universalRaw as Record<string, unknown>)["whatsappTemplate"]),
        }
      : undefined;

  const rulesRaw = Array.isArray(o["rules"]) ? o["rules"] : [];
  const rules = rulesRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      const dispositions = Array.isArray(r["dispositions"])
        ? r["dispositions"]
            .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
            .map((d) => d.trim())
        : [];
      if (!dispositions.length) return null;
      const id =
        typeof r["id"] === "string" && r["id"].trim()
          ? r["id"].trim()
          : `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      return {
        id,
        dispositions,
        whatsapp: !!r["whatsapp"],
        email: !!r["email"],
        whatsappTemplate: parseTemplate(r["whatsappTemplate"]),
      };
    })
    .filter((r): r is NonNullable<typeof r> => !!r);

  return {
    universal: universal ?? { whatsapp: false, email: false },
    skipUniversalWhenMatched: o["skipUniversalWhenMatched"] !== false,
    rules,
  };
}

function parseTemplate(raw: unknown): { name: string; language: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const name = typeof t["name"] === "string" ? t["name"].trim() : "";
  const language = typeof t["language"] === "string" ? t["language"].trim() : "en";
  if (!name) return null;
  return { name, language: language || "en" };
}

export function normalizeAfterCallMessagesInput(raw: unknown): AgentAfterCallMessages | null {
  if (raw === null || raw === undefined) return null;
  return parseAfterCallMessages(raw) ?? EMPTY_AFTER_CALL_MESSAGES;
}

function pickEmail(
  dispositionResult: Record<string, unknown> | null,
  leadEmail?: string | null,
): string {
  const fromLead = (leadEmail ?? "").trim();
  if (fromLead.includes("@")) return fromLead;
  if (!dispositionResult) return "";
  for (const key of ["email", "email_address", "customer_email", "contact_email"]) {
    const v = dispositionResult[key];
    if (typeof v === "string" && v.trim().includes("@")) return v.trim();
  }
  return "";
}

/**
 * Run agent after-call messaging when configured.
 * Returns `{ configured: true }` when the agent has after-call messages set up
 * (even if nothing matched / nothing sent) so callers skip legacy always-on WhatsApp.
 */
export async function maybeRunAgentAfterCallMessages(opts: {
  callId: number;
  agentId?: number | null;
  campaignLeadId?: number | null;
  dispositionResult?: Record<string, unknown> | null;
  callSummary?: string | null;
}): Promise<{ configured: boolean; ran: string[]; reason?: string }> {
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, opts.callId)).limit(1);
  if (!call) return { configured: false, ran: [], reason: "call_missing" };

  const agentId = opts.agentId ?? call.agentId;
  if (!agentId) return { configured: false, ran: [], reason: "no_agent" };

  const [dispRow] = await db
    .select({ afterCallMessages: agentDispositionsTable.afterCallMessages })
    .from(agentDispositionsTable)
    .where(eq(agentDispositionsTable.agentId, agentId))
    .limit(1);

  // null / missing column → legacy always-on WhatsApp. Any saved object (even all-off) owns messaging.
  if (dispRow?.afterCallMessages == null) {
    return { configured: false, ran: [], reason: "not_configured" };
  }
  const config = parseAfterCallMessages(dispRow.afterCallMessages) ?? EMPTY_AFTER_CALL_MESSAGES;

  const dispositionResult =
    opts.dispositionResult ??
    (call.dispositionResult as Record<string, unknown> | null) ??
    null;

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

  const rules = config.rules ?? [];
  const matching = rules.filter((r) =>
    dispositionMatchesAny(dispositionResult, r.dispositions, lead?.disposition ?? null),
  );

  let wantWhatsapp = !!config.universal?.whatsapp;
  let wantEmail = !!config.universal?.email;
  if (config.skipUniversalWhenMatched !== false && matching.length > 0) {
    wantWhatsapp = matching.some((r) => !!r.whatsapp);
    wantEmail = matching.some((r) => !!r.email);
  } else if (matching.length > 0) {
    wantWhatsapp = wantWhatsapp || matching.some((r) => !!r.whatsapp);
    wantEmail = wantEmail || matching.some((r) => !!r.email);
  }

  const ran: string[] = [];

  if (wantWhatsapp) {
    try {
      const waTpl =
        matching.find((r) => r.whatsapp && r.whatsappTemplate)?.whatsappTemplate
        ?? (config.universal?.whatsapp ? config.universal.whatsappTemplate : null);
      await dispatchWhatsappCallEnded(opts.callId, {
        callSummary: opts.callSummary,
        dispositionResult,
        whatsappTemplate: waTpl ?? undefined,
      });
      ran.push("whatsapp");
    } catch (err) {
      logger.warn({ err, callId: opts.callId }, "Agent after-call WhatsApp failed");
    }
  }

  if (wantEmail) {
    try {
      const to = pickEmail(dispositionResult, lead?.email);
      if (to && call.userId) {
        const [agent] = await db
          .select({ name: agentsTable.name })
          .from(agentsTable)
          .where(eq(agentsTable.id, agentId))
          .limit(1);
        const result = await sendChannelEmail({
          userId: call.userId,
          toEmail: to,
          callId: opts.callId,
          context: {
            name: lead?.name ?? "",
            phone: lead?.phone ?? call.toNumber ?? call.fromNumber ?? "",
            email: to,
            agent_name: agent?.name ?? "",
            campaign_name: "",
            disposition: formatDispositionLabel(dispositionResult) || lead?.disposition || "",
            summary: opts.callSummary ?? call.callSummary ?? "",
          },
        });
        if (result.ok) ran.push("email");
        else {
          logger.info(
            { callId: opts.callId, skipped: result.skipped, error: result.error },
            "Agent after-call email skipped",
          );
        }
      }
    } catch (err) {
      logger.warn({ err, callId: opts.callId }, "Agent after-call email failed");
    }
  }

  logger.info(
    { agentId, callId: opts.callId, wantWhatsapp, wantEmail, matching: matching.map((m) => m.id), ran },
    "Agent after-call messages evaluated",
  );
  return { configured: true, ran };
}

/**
 * Campaign outbound call trigger
 * ──────────────────────────────────────────────────────────────────────────
 * Given a campaign lead, resolves the agent + telephony provider and fires
 * an outbound call. Lead form data is substituted into the agent system
 * prompt as {{variable}} template tokens before the call starts.
 */

import { db, campaignsTable, campaignLeadsTable, agentsTable, providersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { dialTwilio, dialPlivo, dialVobiz } from "./telephony/dial.js";
import { decryptKey } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";

function resolveBaseUrl(): string {
  const domains = process.env["REPLIT_DOMAINS"];
  if (domains) return `https://${domains.split(",")[0]!.trim()}`;
  return `http://localhost:${process.env["PORT"] ?? "8080"}`;
}

/**
 * Replace {{key}} placeholders in a string with values from a data map.
 * Unknown placeholders are left as-is.
 */
export function interpolateTemplate(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => data[key] ?? `{{${key}}}`);
}

type LeadRow = typeof campaignLeadsTable.$inferSelect;
type CampaignRow = typeof campaignsTable.$inferSelect;

export async function fireCampaignCall(lead: LeadRow, campaign: CampaignRow): Promise<void> {
  const baseUrl = resolveBaseUrl();

  if (!campaign.agentId) {
    logger.warn({ leadId: lead.id, campaignId: campaign.id }, "Campaign has no agent assigned — skipping call");
    await db.update(campaignLeadsTable)
      .set({ callStatus: "skipped", notes: "No agent assigned to campaign" })
      .where(eq(campaignLeadsTable.id, lead.id));
    return;
  }

  // Mark as calling
  await db.update(campaignLeadsTable)
    .set({
      callStatus: "calling",
      callAttempts: sql`${campaignLeadsTable.callAttempts} + 1`,
      lastAttemptAt: new Date(),
    })
    .where(eq(campaignLeadsTable.id, lead.id));

  try {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, campaign.agentId));
    if (!agent) throw new Error(`Agent ${campaign.agentId} not found`);

    const provider = agent.telephonyProvider.toLowerCase();
    const [provRow] = await db.select().from(providersTable)
      .where(and(eq(providersTable.providerName, provider), eq(providersTable.isActive, true)))
      .limit(1);

    if (!provRow) throw new Error(`No active "${provider}" provider configured`);

    const cfg = provRow.extraConfig
      ? (JSON.parse(provRow.extraConfig) as Record<string, string>)
      : {} as Record<string, string>;

    // Build variable map from lead data (merge named fields + raw leadData)
    const vars: Record<string, string> = {
      phone:  lead.phone,
      name:   lead.name  ?? "",
      email:  lead.email ?? "",
      ...lead.leadData,
    };

    // Patch the agent system prompt with lead variables
    const patchedSystemPrompt = interpolateTemplate(agent.systemPrompt, vars);
    const patchedAgent = { ...agent, systemPrompt: patchedSystemPrompt };

    // Store patched agent in a temp override via query param so the session handler picks it up
    // We embed campaignLeadId in the webhook URL so the call result can be mapped back
    const callbackSuffix = `&campaignLeadId=${lead.id}`;

    if (provider === "twilio") {
      if (!cfg["accountSid"] || !cfg["fromNumber"]) throw new Error("Twilio config missing accountSid or fromNumber");
      const fromNumber = campaign.fromNumber ?? cfg["fromNumber"]!;
      await dialTwilio({
        accountSid: cfg["accountSid"]!,
        authToken: decryptKey(provRow.apiKey),
        fromNumber,
        toNumber: lead.phone,
        webhookUrl: `${baseUrl}/api/webhooks/twilio/voice?agentId=${agent.id}&promptOverride=${encodeURIComponent(patchedSystemPrompt)}${callbackSuffix}`,
        statusCallbackUrl: `${baseUrl}/api/webhooks/twilio/status`,
      });
    } else if (provider === "plivo") {
      if (!cfg["authId"] || !cfg["fromNumber"]) throw new Error("Plivo config missing authId or fromNumber");
      const fromNumber = campaign.fromNumber ?? cfg["fromNumber"]!;
      await dialPlivo({
        authId: cfg["authId"]!,
        authToken: decryptKey(provRow.apiKey),
        fromNumber,
        toNumber: lead.phone,
        answerUrl: `${baseUrl}/api/webhooks/plivo/voice?agentId=${agent.id}&promptOverride=${encodeURIComponent(patchedSystemPrompt)}${callbackSuffix}`,
      });
    } else if (provider === "vobiz") {
      if (!cfg["authId"] || !cfg["fromNumber"]) throw new Error("Vobiz config missing authId or fromNumber");
      const fromNumber = campaign.fromNumber ?? cfg["fromNumber"]!;
      await dialVobiz({
        authId: cfg["authId"]!,
        authToken: decryptKey(provRow.apiKey),
        fromNumber,
        toNumber: lead.phone,
        answerUrl: `${baseUrl}/api/webhooks/vobiz/voice?agentId=${agent.id}&promptOverride=${encodeURIComponent(patchedSystemPrompt)}${callbackSuffix}`,
        hangupUrl: `${baseUrl}/api/webhooks/vobiz/status`,
      });
    } else {
      throw new Error(`Outbound not supported for provider: ${provider}`);
    }

    // Increment campaign counter
    await db.update(campaignsTable)
      .set({ calledLeads: sql`${campaignsTable.calledLeads} + 1` })
      .where(eq(campaignsTable.id, campaign.id));

    logger.info({ leadId: lead.id, campaignId: campaign.id, phone: lead.phone }, "Campaign call fired");
  } catch (err) {
    logger.error({ leadId: lead.id, campaignId: campaign.id, err }, "Campaign call failed");
    await db.update(campaignLeadsTable)
      .set({
        callStatus: "failed",
        notes: err instanceof Error ? err.message : String(err),
      })
      .where(eq(campaignLeadsTable.id, lead.id));
  }
}

/**
 * Schedule a call with an optional delay (callDelaySeconds).
 * If delay is 0, fires immediately; otherwise uses setTimeout.
 */
export function scheduleCampaignCall(lead: LeadRow, campaign: CampaignRow): void {
  const delayMs = (campaign.callDelaySeconds ?? 5) * 1000;
  if (delayMs <= 0) {
    void fireCampaignCall(lead, campaign);
  } else {
    setTimeout(() => { void fireCampaignCall(lead, campaign); }, delayMs);
  }
}

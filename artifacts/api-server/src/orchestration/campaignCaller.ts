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

  // Check concurrency limit before firing
  const limit = campaign.concurrentCallLimit ?? 20;
  const currentlyActive = (await db.select({ count: sql<number>`count(*)` })
    .from(campaignLeadsTable)
    .where(and(
      eq(campaignLeadsTable.campaignId, campaign.id),
      eq(campaignLeadsTable.callStatus, "calling"),
    )))[0]?.count ?? 0;

  if (currentlyActive >= limit) {
    logger.warn({ leadId: lead.id, campaignId: campaign.id, limit, currentlyActive }, "Campaign concurrency limit reached — skipping call");
    await db.update(campaignLeadsTable)
      .set({ callStatus: "pending", notes: `Queued — concurrency limit (${limit}) reached` })
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

    // Read AMD config from the agent's agentConfig JSON
    const agentCfg = (agent.agentConfig ?? {}) as Record<string, unknown>;
    const machineDetectionMode = agentCfg["machineDetectionMode"] as string | undefined;
    const amdEnabled = machineDetectionMode === "enable" || machineDetectionMode === "detect_message_end";

    // campaignLeadId is passed through the webhook URL so the session handler
    // can look up the lead and apply {{variable}} substitution at call-start time.
    if (provider === "twilio") {
      if (!cfg["accountSid"] || !cfg["fromNumber"]) throw new Error("Twilio config missing accountSid or fromNumber");
      const fromNumber = campaign.fromNumber ?? cfg["fromNumber"]!;
      const amdCallbackUrl = `${baseUrl}/api/webhooks/twilio/amd?agentId=${agent.id}`;
      const recordingEnabled = agentCfg["recordingEnabled"] === true;
      await dialTwilio({
        accountSid: cfg["accountSid"]!,
        authToken: decryptKey(provRow.apiKey),
        fromNumber,
        toNumber: lead.phone,
        webhookUrl: `${baseUrl}/api/webhooks/twilio/voice?agentId=${agent.id}&campaignLeadId=${lead.id}`,
        statusCallbackUrl: `${baseUrl}/api/webhooks/twilio/status`,
        ...(amdEnabled ? {
          machineDetection: machineDetectionMode === "detect_message_end" ? "DetectMessageEnd" : "Enable",
          machineDetectionUrl: amdCallbackUrl,
        } : {}),
        ...(recordingEnabled ? {
          recordingEnabled: true,
          recordingStatusCallbackUrl: `${baseUrl}/api/webhooks/twilio/recording`,
        } : {}),
      });
    } else if (provider === "plivo") {
      if (!cfg["authId"] || !cfg["fromNumber"]) throw new Error("Plivo config missing authId or fromNumber");
      const fromNumber = campaign.fromNumber ?? cfg["fromNumber"]!;
      const amdCallbackUrl = `${baseUrl}/api/webhooks/plivo/amd?agentId=${agent.id}`;
      await dialPlivo({
        authId: cfg["authId"]!,
        authToken: decryptKey(provRow.apiKey),
        fromNumber,
        toNumber: lead.phone,
        answerUrl: `${baseUrl}/api/webhooks/plivo/voice?agentId=${agent.id}&campaignLeadId=${lead.id}`,
        ...(amdEnabled ? {
          machineDetectionEnabled: true,
          machineDetectionUrl: amdCallbackUrl,
        } : {}),
      });
    } else if (provider === "vobiz") {
      if (!cfg["authId"] || !cfg["fromNumber"]) throw new Error("Vobiz config missing authId or fromNumber");
      const fromNumber = campaign.fromNumber ?? cfg["fromNumber"]!;
      const amdCallbackUrl = `${baseUrl}/api/webhooks/vobiz/amd?agentId=${agent.id}`;
      await dialVobiz({
        authId: cfg["authId"]!,
        authToken: decryptKey(provRow.apiKey),
        fromNumber,
        toNumber: lead.phone,
        answerUrl: `${baseUrl}/api/webhooks/vobiz/voice?agentId=${agent.id}&campaignLeadId=${lead.id}`,
        hangupUrl: `${baseUrl}/api/webhooks/vobiz/status`,
        ...(amdEnabled ? {
          machineDetection: machineDetectionMode === "detect_message_end" ? "DetectMessageEnd" : "Enable",
          machineDetectionUrl: amdCallbackUrl,
        } : {}),
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

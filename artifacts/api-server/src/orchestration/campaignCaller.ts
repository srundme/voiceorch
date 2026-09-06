/**
 * Campaign outbound call trigger
 * ──────────────────────────────────────────────────────────────────────────
 * Given a campaign lead, resolves the agent + telephony provider and fires
 * an outbound call. Lead form data is substituted into the agent system
 * prompt as {{variable}} template tokens before the call starts.
 */

import {
  db, campaignsTable, campaignLeadsTable, agentsTable, providersTable,
  platformSettingsTable, callExecutionsTable, leadTimelineTable, phoneNumbersTable,
} from "@workspace/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { dialTwilio, dialPlivo, dialVobiz, resolveAmdConfig } from "./telephony/dial.js";
import { decryptKey } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";
import { normalizePhone } from "../lib/phone-normalize.js";
import { isOnDnc } from "../lib/dnc-check.js";
import { traiPreDialCheck, logPreDialDecision } from "../services/trai/index.js";
import { scheduleRetry, resolveRetryConfig } from "../services/retryEngine.js";
import { syncSheetAutoCallDialStatus } from "../services/sheet-auto-call-status.js";
import { createHmac } from "node:crypto";
import { APP_SECRET } from "../lib/app-secret.js";

import { getSelfBaseUrl } from "../lib/app-domain.js";

function resolveBaseUrl(): string {
  return getSelfBaseUrl();
}

type AgentRow = typeof agentsTable.$inferSelect;

/**
 * Same from-number resolution as builder outbound (`/api/calls`):
 * campaign override → agent assigned outbound → provider fromNumber → managed pool.
 */
async function resolveCampaignFromNumber(opts: {
  campaignFrom: string | null | undefined;
  agent: AgentRow;
  provider: string;
  credsFrom?: string | null;
  isManaged: boolean;
}): Promise<string> {
  if (opts.campaignFrom?.trim()) return opts.campaignFrom.trim();

  if (opts.agent.outboundPhoneNumberId) {
    const [pn] = await db
      .select({ number: phoneNumbersTable.number })
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.id, opts.agent.outboundPhoneNumberId))
      .limit(1);
    if (pn?.number) return pn.number;
  }

  if (opts.credsFrom?.trim()) return opts.credsFrom.trim();

  if (opts.isManaged && opts.provider === "vobiz") {
    const agentCfg = (opts.agent.agentConfig ?? {}) as Record<string, unknown>;
    const [numbersRow] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "managed_phone_numbers"))
      .limit(1);
    const numbers: string[] = numbersRow?.value
      ? (JSON.parse(numbersRow.value) as string[])
      : [];
    const preferred = (agentCfg["preferredManagedNumber"] as string | undefined) ?? null;
    if (preferred && numbers.includes(preferred)) return preferred;
    if (numbers.length > 0) {
      return numbers[Math.floor(Math.random() * numbers.length)]!;
    }
  }

  throw new Error(
    `No outbound from-number available for ${opts.provider}. ` +
    `Assign a number on the agent, pick one in Automatic Calls, or configure managed phone numbers.`,
  );
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
    await addTimelineEvent(lead.id, campaign.id, "call_failed", { reason: "No agent assigned" });
    await syncSheetAutoCallDialStatus(lead, {
      status: "skipped",
      error: "No agent assigned to campaign",
      bumpFailed: true,
    });
    return;
  }

  // Normalize phone if not already done
  const normalized = lead.normalizedPhone ?? normalizePhone(lead.phone);
  if (!lead.normalizedPhone) {
    await db.update(campaignLeadsTable)
      .set({ normalizedPhone: normalized })
      .where(eq(campaignLeadsTable.id, lead.id));
  }

  // DNC check
  const onDnc = await isOnDnc(campaign.userId, normalized);
  if (onDnc) {
    logger.info({ leadId: lead.id, phone: normalized }, "Lead is on DNC — skipping");
    await db.update(campaignLeadsTable)
      .set({ callStatus: "skipped", notes: "Number on Do Not Call list" })
      .where(eq(campaignLeadsTable.id, lead.id));
    await addTimelineEvent(lead.id, campaign.id, "dnc_blocked", { normalizedPhone: normalized });
    await syncSheetAutoCallDialStatus(lead, {
      status: "skipped",
      error: "Number on Do Not Call list",
      bumpFailed: true,
    });
    return;
  }

  // TRAI compliance pre-dial gate (calling-hours + suppression list).
  // Independent from DNC. Only runs when the campaign's agent has TRAI enabled.
  if (campaign.agentId) {
    const [traiAgent] = await db
      .select({ agentConfig: agentsTable.agentConfig })
      .from(agentsTable)
      .where(eq(agentsTable.id, campaign.agentId));
    const traiEnabled = !!((traiAgent?.agentConfig as { compliance?: { trai?: boolean } } | null)?.compliance?.trai);
    if (traiEnabled) {
      const traiTimezone = (traiAgent?.agentConfig as { timezone?: string } | null)?.timezone ?? null;
      const traiResult = await traiPreDialCheck(normalized, traiTimezone);
      await logPreDialDecision({
        agentId: campaign.agentId, callId: null, phoneNumber: normalized,
        allowed: traiResult.allowed, reason: traiResult.reason,
      });
      if (!traiResult.allowed) {
        const reason = traiResult.reason ?? "Blocked by TRAI compliance";
        const outsideHours = /Outside permitted calling hours/i.test(reason);
        logger.info({ leadId: lead.id, phone: normalized, reason }, "Lead blocked by TRAI compliance — skipping");
        if (outsideHours) {
          // Keep pending so Automatic Calls / campaign refill can dial in-window.
          await db.update(campaignLeadsTable)
            .set({ callStatus: "pending", notes: reason })
            .where(eq(campaignLeadsTable.id, lead.id));
          await addTimelineEvent(lead.id, campaign.id, "call_failed", { reason, normalizedPhone: normalized, deferred: true });
          await syncSheetAutoCallDialStatus(lead, { status: "enqueued", error: reason });
        } else {
          await db.update(campaignLeadsTable)
            .set({ callStatus: "skipped", notes: reason })
            .where(eq(campaignLeadsTable.id, lead.id));
          await addTimelineEvent(lead.id, campaign.id, "call_failed", { reason, normalizedPhone: normalized });
          await syncSheetAutoCallDialStatus(lead, { status: "skipped", error: reason, bumpFailed: true });
        }
        return;
      }
    }
  }

  // Leads pre-claimed by fireStartBatch already have callStatus = "calling".
  // They skip the concurrency gate (enforced at claim time) and the redundant
  // callStatus update — we only increment the attempt counter.
  const isPreClaimed = lead.callStatus === "calling";

  if (!isPreClaimed) {
    // Workflow (call-plan) campaigns share the account concurrentLimit pool.
    // Regular campaigns keep their per-campaign concurrentCallLimit.
    let limit = campaign.concurrentCallLimit ?? 20;
    let currentlyActive = 0;
    if (campaign.leadSource === "workflow") {
      const {
        getUserConcurrentLimit,
        countActiveWorkflowCallsForUser,
      } = await import("../services/workflow-dial-queue.js");
      limit = await getUserConcurrentLimit(campaign.userId);
      currentlyActive = await countActiveWorkflowCallsForUser(campaign.userId);
    } else {
      currentlyActive = (await db.select({ count: sql<number>`count(*)` })
        .from(campaignLeadsTable)
        .where(and(
          eq(campaignLeadsTable.campaignId, campaign.id),
          inArray(campaignLeadsTable.callStatus, ["calling", "connected"]),
        )))[0]?.count ?? 0;
    }

    if (currentlyActive >= limit) {
      logger.warn({ leadId: lead.id, campaignId: campaign.id, limit, currentlyActive, leadSource: campaign.leadSource }, "Campaign concurrency limit reached — skipping call");
      await db.update(campaignLeadsTable)
        .set({ callStatus: "pending", notes: `Queued — concurrency limit (${limit}) reached` })
        .where(eq(campaignLeadsTable.id, lead.id));
      await syncSheetAutoCallDialStatus(lead, {
        status: "enqueued",
        error: `Queued — concurrency limit (${limit}) reached`,
      });
      return;
    }
  }

  // Max-attempts cap — never dial or increment past the configured maximum.
  // Resolves batch-level Execution Rules, falling back to campaign defaults.
  // This protects both the rolling-refill claim path and the retry-fire path
  // from pushing callAttempts past the limit (e.g. a duplicate/raced retry).
  const currentAttempts = lead.callAttempts ?? 0;
  const { maxAttempts } = await resolveRetryConfig(lead.batchId, campaign);
  if (currentAttempts >= maxAttempts) {
    logger.warn(
      { leadId: lead.id, campaignId: campaign.id, currentAttempts, maxAttempts },
      "Max attempts reached — skipping dial",
    );
    // Free any pre-claimed 'calling' slot so rolling refill is not starved and
    // the lead settles into a terminal (exhausted) state instead of stuck.
    if (isPreClaimed) {
      await db.update(campaignLeadsTable)
        .set({ callStatus: "failed", notes: `Max attempts (${maxAttempts}) reached` })
        .where(and(
          eq(campaignLeadsTable.id, lead.id),
          eq(campaignLeadsTable.callStatus, "calling"),
        ));
    }
    return;
  }

  // ── Atomic dial claim ──────────────────────────────────────────────────────
  // Transition the lead and increment the attempt counter in a SINGLE
  // conditional UPDATE so the attempt is counted EXACTLY ONCE — only when this
  // invocation wins the claim. Two independent paths can race to dial the same
  // lead (the rolling-refill atomic claim and a processRetries-deferred fire);
  // without an atomic guard both would increment callAttempts AND place a dial,
  // inflating "Attempt N of N" and exhausting the lead far faster than the
  // configured retry spacing. The loser sees the row already moved out of its
  // expected status and bails without dialing or touching the counter, so
  // callAttempts/lastAttemptAt only ever reflect a real outbound dial.
  //
  // The non-pre-claimed path also re-asserts the retry-timing gate: a lead
  // carrying a not-yet-due pending call_retries row is never dialed early. This
  // makes call_retries.scheduledAt the single source of truth for retry spacing
  // across every dial path (rolling refill, batch start, and this direct fire).
  let newAttempts: number;
  if (isPreClaimed) {
    const claimed = await db.execute<{ call_attempts: number }>(sql`
      UPDATE campaign_leads
      SET call_attempts = call_attempts + 1, last_attempt_at = now()
      WHERE id = ${lead.id} AND call_status = 'calling'
      RETURNING call_attempts
    `);
    if (claimed.rows.length === 0) {
      logger.info({ leadId: lead.id, campaignId: campaign.id }, "Dial skipped — pre-claimed lead no longer 'calling' (ended/claimed elsewhere)");
      return;
    }
    newAttempts = Number(claimed.rows[0]!.call_attempts);
  } else {
    const claimed = await db.execute<{ call_attempts: number }>(sql`
      UPDATE campaign_leads
      SET call_status = 'calling', call_attempts = call_attempts + 1, last_attempt_at = now()
      WHERE id = ${lead.id}
        AND call_status = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM call_retries cr
          WHERE cr.lead_id = campaign_leads.id
            AND cr.status = 'pending'
            AND cr.scheduled_at > now()
        )
      RETURNING call_attempts
    `);
    if (claimed.rows.length === 0) {
      logger.info({ leadId: lead.id, campaignId: campaign.id }, "Dial skipped — lead not dialable (claimed elsewhere or has a not-yet-due retry)");
      return;
    }
    newAttempts = Number(claimed.rows[0]!.call_attempts);
  }

  await addTimelineEvent(lead.id, campaign.id, "call_started", { attemptNumber: newAttempts });

  try {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, campaign.agentId));
    if (!agent) throw new Error(`Agent ${campaign.agentId} not found`);

    const provider = agent.telephonyProvider.toLowerCase();

    // ── 1. Try user BYOP provider key ──────────────────────────────────────────
    const [provRow] = await db.select().from(providersTable)
      .where(and(
        eq(providersTable.userId, campaign.userId),
        eq(providersTable.providerName, provider),
        eq(providersTable.isActive, true),
      ))
      .limit(1);

    // ── 2. Fall back to platform-managed credentials ────────────────────────────
    // Admin sets these in platform_settings as:
    //   managed_{provider}_auth_id   → authId / accountSid
    //   managed_{provider}_api_key   → auth token / secret
    // VoBiz: VOBIZ_AUTH_ID / VOBIZ_AUTH_TOKEN env vars serve as the ultimate
    // fallback so managed-plan campaigns work out of the box.
    type ProviderCreds = {
      apiKey:      string;
      authId?:     string;
      accountSid?: string;
      fromNumber?: string;
      isManaged:   boolean;
    };

    let creds: ProviderCreds | null = null;

    if (provRow) {
      const byopCfg = provRow.extraConfig
        ? (JSON.parse(provRow.extraConfig) as Record<string, string>)
        : {} as Record<string, string>;
      creds = {
        apiKey:      decryptKey(provRow.apiKey),
        authId:      byopCfg["authId"],
        accountSid:  byopCfg["accountSid"],
        fromNumber:  byopCfg["fromNumber"],
        isManaged:   false,
      };
    } else {
      const [[psAuthId], [psApiKey]] = await Promise.all([
        db.select({ value: platformSettingsTable.value })
          .from(platformSettingsTable)
          .where(eq(platformSettingsTable.key, `managed_${provider}_auth_id`)),
        db.select({ value: platformSettingsTable.value })
          .from(platformSettingsTable)
          .where(eq(platformSettingsTable.key, `managed_${provider}_api_key`)),
      ]);
      const authId  = psAuthId?.value  || (provider === "vobiz" ? (process.env["VOBIZ_AUTH_ID"]    ?? "") : "");
      const authKey = psApiKey?.value  || (provider === "vobiz" ? (process.env["VOBIZ_AUTH_TOKEN"] ?? "") : "");
      if (authId && authKey) {
        // Twilio's "authId" field is its accountSid — normalise here so the
        // Twilio dial branch can read creds.accountSid without special-casing.
        creds = {
          apiKey:      authKey,
          authId:      provider !== "twilio" ? authId : undefined,
          accountSid:  provider === "twilio"  ? authId : undefined,
          isManaged:   true,
        };
        logger.info({ leadId: lead.id, campaignId: campaign.id, provider }, "Campaign call using platform-managed credentials");
      }
    }

    if (!creds) {
      throw new Error(
        `No active "${provider}" provider key configured for this account. ` +
        `Add a ${provider} key in the Providers page.`
      );
    }

    const agentCfg = (agent.agentConfig ?? {}) as Record<string, unknown>;
    // AMD (synchronous voicemail detection) — normalised across both config shapes.
    const amd = resolveAmdConfig(agentCfg);

    const fromNumber = await resolveCampaignFromNumber({
      campaignFrom: campaign.fromNumber,
      agent,
      provider,
      credsFrom: creds.fromNumber,
      isManaged: creds.isManaged,
    });

    if (provider === "twilio") {
      const accountSid = creds.accountSid;
      if (!accountSid) throw new Error("Twilio config missing accountSid");
      const recordingEnabled = agentCfg["recordingEnabled"] === true;
      const twilioLeadSig = createHmac("sha256", APP_SECRET).update(`campaignlead:${lead.id}`).digest("hex");
      await dialTwilio({
        accountSid,
        authToken: creds.apiKey,
        fromNumber,
        toNumber: lead.phone,
        webhookUrl: `${baseUrl}/api/webhooks/twilio/voice?agentId=${agent.id}&campaignLeadId=${lead.id}&dir=out`,
        statusCallbackUrl: `${baseUrl}/api/webhooks/twilio/status?campaignLeadId=${lead.id}&campaignLeadSig=${twilioLeadSig}`,
        ...(amd.enabled ? { machineDetection: amd.twilioMode } : {}),
        ...(recordingEnabled ? {
          recordingEnabled: true,
          recordingStatusCallbackUrl: `${baseUrl}/api/webhooks/twilio/recording`,
        } : {}),
      });
    } else if (provider === "plivo") {
      const authId = creds.authId;
      if (!authId) throw new Error("Plivo config missing authId");
      const plivoLeadSig = createHmac("sha256", APP_SECRET).update(`campaignlead:${lead.id}`).digest("hex");
      await dialPlivo({
        authId,
        authToken: creds.apiKey,
        fromNumber,
        toNumber: lead.phone,
        answerUrl: `${baseUrl}/api/webhooks/plivo/voice?agentId=${agent.id}&campaignLeadId=${lead.id}&dir=out`,
        hangupUrl: `${baseUrl}/api/webhooks/plivo/campaign-status?campaignLeadId=${lead.id}&campaignLeadSig=${plivoLeadSig}`,
        ...(amd.enabled ? { machineDetectionEnabled: true } : {}),
      });
    } else if (provider === "vobiz") {
      const authId = creds.authId;
      if (!authId) throw new Error("Vobiz config missing authId");
      const vobizLeadSig = createHmac("sha256", APP_SECRET).update(`campaignlead:${lead.id}`).digest("hex");
      // The dial response returns a `request_uuid`, NOT the live `call_uuid` that
      // /Call/{uuid}/Transfer/ requires — so we do NOT persist it for transfer.
      // For campaign calls the live `CallUUID` is delivered on the answer webhook
      // and threaded through to the WS session, which writes it onto the (freshly
      // created) call record. campaignLeadId already correlates dial → webhook.
      const dialRes = await dialVobiz({
        authId,
        authToken: creds.apiKey,
        fromNumber,
        toNumber: lead.phone,
        answerUrl: `${baseUrl}/api/webhooks/vobiz/voice?agentId=${agent.id}&campaignLeadId=${lead.id}${creds.isManaged ? "&pt=1" : ""}&dir=out`,
        hangupUrl: `${baseUrl}/api/webhooks/vobiz/status?campaignLeadId=${lead.id}&campaignLeadSig=${vobizLeadSig}`,
        ...(amd.enabled ? { machineDetectionEnabled: true, machineDetectionUrl: `${baseUrl}/api/webhooks/vobiz/amd?agentId=${agent.id}` } : {}),
      });
      logger.info({ leadId: lead.id, dialRequestUuid: dialRes.requestUuid, fromNumber, managed: creds.isManaged }, "VoBiz campaign call dialed");
    } else {
      throw new Error(`Outbound not supported for provider: ${provider}`);
    }

    // Increment campaign counter
    await db.update(campaignsTable)
      .set({ calledLeads: sql`${campaignsTable.calledLeads} + 1` })
      .where(eq(campaignsTable.id, campaign.id));

    logger.info({ leadId: lead.id, campaignId: campaign.id, phone: lead.phone }, "Campaign call fired");
    await syncSheetAutoCallDialStatus(lead, { status: "dialing", error: null, bumpDialed: true });
  } catch (err) {
    logger.error({ leadId: lead.id, campaignId: campaign.id, err }, "Campaign call failed");
    const errMsg = err instanceof Error ? err.message : String(err);
    await db.update(campaignLeadsTable)
      .set({ callStatus: "failed", notes: errMsg })
      .where(eq(campaignLeadsTable.id, lead.id));

    await addTimelineEvent(lead.id, campaign.id, "call_failed", { reason: errMsg, attempt: newAttempts });
    await syncSheetAutoCallDialStatus(lead, { status: "failed", error: errMsg, bumpFailed: true });

    // Schedule auto-retry if attempts remaining
    const { maxAttempts, retryDelayMinutes } = await resolveRetryConfig(lead.batchId, campaign);
    await scheduleRetry({
      leadId:            lead.id,
      campaignId:        campaign.id,
      currentAttempts:   newAttempts,
      maxAttempts,
      retryDelayMinutes,
      reason:            "failed",
    });
  }
}

/** Record an execution and update lead.callId after a call is created */
export async function recordCallExecution(opts: {
  leadId: number;
  campaignId: number;
  batchId: number | null;
  callId: number;
  attemptNumber: number;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${opts.callId})`);
    const [existing] = await tx
      .select({ id: callExecutionsTable.id })
      .from(callExecutionsTable)
      .where(eq(callExecutionsTable.callId, opts.callId))
      .limit(1);
    if (!existing) {
      await tx.insert(callExecutionsTable).values({
        leadId:        opts.leadId,
        campaignId:    opts.campaignId,
        batchId:       opts.batchId,
        callId:        opts.callId,
        attemptNumber: opts.attemptNumber,
      });
    }

    await tx.update(campaignLeadsTable)
      .set({ callId: opts.callId })
      .where(eq(campaignLeadsTable.id, opts.leadId));
  });
}

async function addTimelineEvent(
  leadId: number,
  campaignId: number,
  eventType: string,
  data?: Record<string, unknown>,
): Promise<void> {
  await db.insert(leadTimelineTable).values({ leadId, campaignId, eventType, data: data ?? {} });
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

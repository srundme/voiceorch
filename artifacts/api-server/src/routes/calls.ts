import { Router, type IRouter } from "express";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { randomBytes } from "crypto";
import { eq, desc, and, or, sql, gte, gt, lte, isNull, inArray } from "drizzle-orm";
import { db, callsTable, callEventsTable, executionLogsTable, agentsTable, providersTable, usersTable, walletTransactionsTable, activityLogsTable, callTransfersTable, vobizAccountsTable, verifiedPhoneDestinationsTable, platformSettingsTable, phoneNumbersTable, callerProfilesTable, callerFactsTable, callerCallArchiveTable, callExecutionsTable, canonicalizeCallerKey, humanPhone, resolveCallerKey } from "@workspace/db";
import { computeProRataDebitCents } from "../services/call-billing.js";
import { resolveAgentBillingMode, resolveOwnTelephonyDiscount, resolveBillingRateCentsPerMin } from "../services/minute-rates.js";
import { resolvePartnerBilling, creditPartnerSpreadOnCall } from "../services/partner-billing.js";
import {
  InitiateCallBody,
  InitiateOutboundCallBody,
  UpdateCallBody,
  GetCallParams,
  UpdateCallParams,
  EndCallParams,
  ListCallsQueryParams,
  ListCallsResponse,
  ListCallsResponseItem,
  GetCallResponse,
  GetCallCallerMemoryResponse,
  UpdateCallResponse,
  EndCallResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext } from "../middlewares/clientContext.js";
import { getAuth } from "../lib/auth-compat.js";
import {
  buildCallEndedWebhookPayload,
  dispatchWebhooks,
  flatDispositionFromTaxonomy,
} from "./webhook-endpoints.js";
import {
  buildAgentNotifyHeaders,
  readWebhookPayloadTemplate,
  serializeAgentWebhookBody,
} from "../lib/webhook-payload-template.js";
import { disposeCall } from "../services/disposition.js";
import { traiPreDialCheck, logPreDialDecision } from "../services/trai/index.js";
import { evaluateIrdaiGate, IRDAI_BLOCKED_MESSAGE, IRDAI_BLOCKED_CODE } from "../services/irdai/gate.js";
import { normalizeCallVariables } from "../orchestration/prompt-vars.js";
import { canAccessWorkspaceCall, resolveWorkspaceScope, workspaceCallsWhere } from "../services/workspace-scope.js";
import { logger } from "../lib/logger.js";

const CALL_LIST_STATUSES = new Set([
  "pending", "ringing", "in_progress", "connected", "completed", "failed",
  "cancelled", "transferred", "no_pickup", "voicemail", "busy", "booked", "callback_scheduled",
]);

function sanitizeCallStatus(status: string): string {
  if (CALL_LIST_STATUSES.has(status)) return status;
  if (status === "error" || status === "ended") return "failed";
  if (status === "no_answer" || status === "no-answer" || status === "noanswer") return "no_pickup";
  return "completed";
}

/** Zod list/detail schemas reject null/array/object disposition values — one bad row 500s History. */
function sanitizeDispositionResult(
  raw: unknown,
): Record<string, string | number | boolean> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function parseLatencyBody(body: unknown): { sttLatencyMs?: number; llmLatencyMs?: number; ttsFirstChunkMs?: number } {
  if (!body || typeof body !== "object") return {};
  const b = body as Record<string, unknown>;
  const intOrUndef = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : undefined);
  return {
    sttLatencyMs:    intOrUndef(b.sttLatencyMs),
    llmLatencyMs:    intOrUndef(b.llmLatencyMs),
    ttsFirstChunkMs: intOrUndef(b.ttsFirstChunkMs),
  };
}

const router: IRouter = Router();

function deriveDirection(call: typeof callsTable.$inferSelect, campaignId?: number | null): "inbound" | "outbound" {
  const isWeb = (call.fromNumber ?? "").startsWith("webcall") || (call.toNumber ?? "").startsWith("webcall");
  if (isWeb) return "outbound";
  if (campaignId != null) return "outbound";
  const rawMeta = call.metadata;
  if (typeof rawMeta === "string" && rawMeta.length > 0) {
    try {
      const parsed = JSON.parse(rawMeta);
      if (parsed?.direction === "inbound" || parsed?.direction === "outbound") {
        return parsed.direction;
      }
    } catch {
      // not valid JSON
    }
  }
  return "inbound";
}

async function enrichCall(call: typeof callsTable.$inferSelect, campaignId?: number | null) {
  const [agent] = await db
    .select({ name: agentsTable.name, agentConfig: agentsTable.agentConfig })
    .from(agentsTable)
    .where(eq(agentsTable.id, call.agentId));
  const recordingEnabled = agent?.agentConfig?.recordingEnabled ?? false;
  return {
    ...call,
    status: sanitizeCallStatus(call.status),
    dispositionResult: sanitizeDispositionResult(call.dispositionResult),
    agentName: agent?.name ?? "Unknown Agent",
    recordingEnabled,
    endedAt: call.endedAt?.toISOString() ?? null,
    createdAt: call.createdAt.toISOString(),
    direction: deriveDirection(call, campaignId),
  };
}

async function checkUsageLimits(agent: typeof agentsTable.$inferSelect): Promise<string | null> {
  if (agent.maxConcurrentCalls != null) {
    const [{ activeCount }] = await db
      .select({ activeCount: sql<number>`count(*)::int` })
      .from(callsTable)
      .where(and(eq(callsTable.agentId, agent.id), inArray(callsTable.status, ["ringing", "in_progress"])));
    if ((activeCount ?? 0) >= agent.maxConcurrentCalls) {
      return `Agent has reached its concurrent call limit (${agent.maxConcurrentCalls}).`;
    }
  }
  if (agent.monthlySpendLimitCents != null) {
    const monthStart = new Date();
    monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const [{ spent }] = await db
      .select({ spent: sql<number>`coalesce(sum(cost_cents), 0)::int` })
      .from(callsTable)
      .where(and(eq(callsTable.agentId, agent.id), gte(callsTable.createdAt, monthStart)));
    if ((spent ?? 0) >= agent.monthlySpendLimitCents) {
      return `Agent has reached its monthly spend limit (₹${(agent.monthlySpendLimitCents / 100).toFixed(2)}).`;
    }
  }
  return null;
}

/* ── Outbound call helpers ────────────────────────────────────────────────── */

function resolveWebhookBase(req: Parameters<Parameters<IRouter["post"]>[1]>[0], override?: string): string {
  if (override) return override.replace(/\/$/, "");
  // WEBHOOK_BASE_URL takes absolute priority — use this to pin Railway prod URL
  // even when calls are initiated from the Replit dev dashboard (where REPLIT_DOMAINS
  // would otherwise produce a Replit dev URL that VoBiz can't WebSocket back to).
  const webhookBaseUrl = process.env["WEBHOOK_BASE_URL"];
  if (webhookBaseUrl) return webhookBaseUrl.replace(/\/$/, "");
  const appBase = getSelfBaseUrl();
  if (appBase !== `http://localhost:${process.env["PORT"] ?? "8080"}`) return appBase;
  const host = req.headers["x-forwarded-host"] ?? req.hostname;
  const proto = (req.headers["x-forwarded-proto"] ?? "https") as string;
  return `${proto}://${host}`;
}

import { dialTwilio, dialPlivo, dialVobiz, resolveAmdConfig } from "../orchestration/telephony/dial.js";
import { decryptKey } from "../lib/crypto.js";
import { triggerTransfer } from "../orchestration/session.js";
import { sendBrevoSms } from "../services/brevo.js";
import { generateAndStoreOtp, verifyDestinationOtp } from "../services/phone-otp.js";

/* ── POST /calls/outbound ─────────────────────────────────────────────────── */

router.post("/calls/outbound", requireAuth, clientContext, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const parsed = InitiateOutboundCallBody.passthrough().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }
  const { agentId, toNumber, webhookBaseUrl, variables, parameters, ...rest } = parsed.data;
  const callVariables = normalizeCallVariables({
    ...(rest as Record<string, unknown>),
    ...(parameters && typeof parameters === "object" ? parameters : {}),
    ...(variables && typeof variables === "object" ? variables : {}),
  });

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  if (agent.userId !== userId) {
    const scope = await resolveWorkspaceScope(userId ?? "");
    if (!userId || !agent.userId || !scope.userIds.includes(agent.userId) || !scope.canWrite) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }

  // IRDAI compliance enforcement gate. Reads the agent's latest stored
  // irdaiComplianceStatus (no re-check at call time). Blocks the dial-out when
  // IRDAI is enabled AND any required disclosure is still missing.
  const irdaiGate = evaluateIrdaiGate(agent.agentConfig);
  if (irdaiGate.blocked) {
    req.log.info({ agentId, missing: irdaiGate.missingItems.map((m) => m.requirement) }, "Outbound call blocked by IRDAI compliance");
    res.status(403).json({
      error: IRDAI_BLOCKED_MESSAGE,
      code: IRDAI_BLOCKED_CODE,
      missingItems: irdaiGate.missingItems,
    });
    return;
  }

  // TRAI compliance pre-dial gate (calling-hours + suppression list).
  // Only runs when the agent has TRAI enabled. Blocks before reaching any provider.
  const traiEnabled = !!((agent.agentConfig as { compliance?: { trai?: boolean } } | null)?.compliance?.trai);
  if (traiEnabled) {
    const traiTimezone = (agent.agentConfig as { timezone?: string } | null)?.timezone ?? null;
    const traiResult = await traiPreDialCheck(toNumber, traiTimezone);
    await logPreDialDecision({
      agentId, callId: null, phoneNumber: toNumber,
      allowed: traiResult.allowed, reason: traiResult.reason,
    });
    if (!traiResult.allowed) {
      req.log.info({ agentId, toNumber, reason: traiResult.reason }, "Outbound call blocked by TRAI compliance");
      res.status(403).json({ error: traiResult.reason ?? "Call blocked by TRAI compliance.", code: "TRAI_BLOCKED" });
      return;
    }
  }

  // Look up agent's assigned outbound phone number (overrides provider fromNumber)
  let agentOutboundNumber: string | null = null;
  if ((agent as any).outboundPhoneNumberId) {
    const [pn] = await db.select({ number: phoneNumbersTable.number })
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.id, (agent as any).outboundPhoneNumberId as number));
    if (pn) agentOutboundNumber = pn.number;
  }

  // Balance gate + max call duration limiter.
  //
  // The value passed to the telephony provider becomes a HARD PSTN-leg cut
  // (Twilio `TimeLimit`, Plivo/Vobiz `time_limit`). It must only ever act as a
  // safety backstop ABOVE the agent's configured max duration — NEVER as a
  // billing enforcer. A low-but-positive wallet balance must not collapse this to
  // ~1 minute, or a healthy call gets dropped mid-conversation. Billing is
  // reconciled at call-end (the wallet is debited then); the `<= 0` balance gate
  // below is the real safeguard against starting a call with no credit.
  //
  // Floor = max(agent's configured maxDuration, 600s) so a normal conversation is
  // never cut short, plus a buffer so the app-level max-duration timer
  // (session.ts / webcall.ts) ends the call gracefully BEFORE the provider's
  // abrupt hard cut.
  const PROVIDER_LIMIT_BUFFER_SECONDS = 120;
  const agentMaxDurationSeconds = agent.maxDuration ?? 600;
  const minProviderLimitSeconds = Math.max(agentMaxDurationSeconds, 600);
  // Always seed with a safe baseline so VoBiz receives a time_limit even if
  // the user row is missing from the DB.  Without this, VoBiz falls back to
  // its ~3-minute platform default and sends a BYE mid-conversation.
  let maxDurationSeconds: number = minProviderLimitSeconds + PROVIDER_LIMIT_BUFFER_SECONDS;
  if (agent.userId) {
    const [user] = await db.select({ walletBalanceCents: usersTable.walletBalanceCents })
      .from(usersTable).where(eq(usersTable.clerkId, agent.userId));
    if (user && user.walletBalanceCents <= 0) {
      res.status(402).json({ error: "Insufficient balance. Please top up your wallet to start calls." });
      return;
    }
    if (user && user.walletBalanceCents > 0) {
      const billingMode = await resolveAgentBillingMode(agent.userId, agent);
      // Partner-managed clients are billed at their partner-set rate — the
      // credit-seconds estimate must use the same rate as the final debit.
      const agentRate = (await resolvePartnerBilling(agent.userId))?.clientRateCentsPerMin
        ?? Math.max(0, (await resolveBillingRateCentsPerMin(billingMode)) - await resolveOwnTelephonyDiscount(agent.userId, agent));
      const creditSeconds = agentRate > 0
        ? Math.floor((user.walletBalanceCents / agentRate) * 60)
        : 0;
      // Baseline floor never below the agent's configured max (+buffer); extend the
      // hard cap only when there is plenty of credit. Crucially, a small credit
      // amount can no longer drive this below the floor → no 60s cutoff.
      const baseline = minProviderLimitSeconds + PROVIDER_LIMIT_BUFFER_SECONDS;
      maxDurationSeconds = Math.max(baseline, creditSeconds);
      req.log.info(
        {
          agentId,
          walletBalanceCents: user.walletBalanceCents,
          agentRateCentsPerMin: agentRate,
          agentMaxDurationSeconds,
          creditSeconds,
          resolvedProviderLimitSeconds: maxDurationSeconds,
        },
        "Resolved provider call duration limit",
      );
    }
  }

  // Usage limit checks
  const limitError = await checkUsageLimits(agent);
  if (limitError) { res.status(429).json({ error: limitError }); return; }

  const provider = agent.telephonyProvider.toLowerCase();
  const [providerRow] = await db
    .select()
    .from(providersTable)
    .where(and(eq(providersTable.providerName, provider), eq(providersTable.userId, agent.userId!)))
    .limit(1);

  // Vobiz can fall back to managed platform numbers — all other providers need their own credentials
  if (!providerRow && provider !== "vobiz") {
    res.status(404).json({ error: `No "${provider}" telephony provider key configured. Add it on the Providers page.` });
    return;
  }

  const baseUrl = resolveWebhookBase(req, webhookBaseUrl);
  let providerCallId: string = "";
  // VoBiz-only correlation: the dial response returns a `request_uuid`, NOT the
  // live `call_uuid`. We mint our own opaque `corr` token, embed it on the answer
  // webhook URL, and persist it on the call record so the answer-webhook/WS path
  // can match THIS exec_* row and write the live `CallUUID` over the placeholder.
  let vobizRequestUuid: string | null = null;
  let vobizCorrToken: string | null = null;
  let effectiveFromNumber = "outbound";

  // AMD (synchronous voicemail detection) — normalised across both config shapes.
  const amd = resolveAmdConfig((agent.agentConfig ?? {}) as Record<string, unknown>);

  try {
    if (provider === "twilio") {
      const cfg = providerRow!.extraConfig ? JSON.parse(providerRow!.extraConfig) as Record<string, string> : {};
      if (!cfg["accountSid"]) { res.status(400).json({ error: 'Twilio provider is missing "accountSid" in Extra Config. Edit the provider and add: {"accountSid":"ACxxx","fromNumber":"+1xxx"}' }); return; }
      if (!cfg["fromNumber"]) { res.status(400).json({ error: 'Twilio provider is missing "fromNumber" in Extra Config. Edit the provider and add a "fromNumber" field.' }); return; }
      effectiveFromNumber = cfg["fromNumber"]!;
      providerCallId = await dialTwilio({
        accountSid: cfg["accountSid"]!, authToken: decryptKey(providerRow!.apiKey),
        fromNumber: cfg["fromNumber"]!, toNumber,
        webhookUrl: `${baseUrl}/api/webhooks/twilio/voice?agentId=${agentId}&dir=out`,
        statusCallbackUrl: `${baseUrl}/api/webhooks/twilio/status`,
        maxDurationSeconds,
        ...(amd.enabled && { machineDetection: amd.twilioMode }),
      });
    } else if (provider === "plivo") {
      const cfg = providerRow!.extraConfig ? JSON.parse(providerRow!.extraConfig) as Record<string, string> : {};
      if (!cfg["authId"]) { res.status(400).json({ error: 'Plivo provider is missing "authId" in Extra Config. Edit the provider and add: {"authId":"MAxx","fromNumber":"+1xxx"}' }); return; }
      if (!cfg["fromNumber"]) { res.status(400).json({ error: 'Plivo provider is missing "fromNumber" in Extra Config.' }); return; }
      effectiveFromNumber = cfg["fromNumber"]!;
      providerCallId = await dialPlivo({
        authId: cfg["authId"]!, authToken: decryptKey(providerRow!.apiKey),
        fromNumber: cfg["fromNumber"]!, toNumber,
        answerUrl: `${baseUrl}/api/webhooks/plivo/voice?agentId=${agentId}&dir=out`,
        maxDurationSeconds,
        ...(amd.enabled && { machineDetectionEnabled: true }),
      });
    } else if (provider === "vobiz") {
      const agentCfg2    = (agent.agentConfig ?? {}) as Record<string, unknown>;
      const cfg          = providerRow?.extraConfig ? JSON.parse(providerRow.extraConfig) as Record<string, string> : {};
      const hasOwnCreds  = !!(providerRow && cfg["authId"] && cfg["fromNumber"]);

      if (hasOwnCreds) {
        // ── Own Vobiz sub-account — KYC required for regulatory compliance ──
        if (agent.userId) {
          const [kycAccount] = await db
            .select({ kycStatus: vobizAccountsTable.kycStatus })
            .from(vobizAccountsTable)
            .where(eq(vobizAccountsTable.userId, agent.userId));
          if (!kycAccount || kycAccount.kycStatus !== "completed") {
            res.status(403).json({
              error: "Identity verification is required to use your own Vobiz number. Please complete KYC in the Verification section.",
              code: "KYC_REQUIRED",
            });
            return;
          }
        }
        effectiveFromNumber = cfg["fromNumber"]!;
        vobizCorrToken = randomBytes(8).toString("hex");
        {
          const dialRes = await dialVobiz({
            authId: cfg["authId"]!, authToken: decryptKey(providerRow!.apiKey),
            fromNumber: cfg["fromNumber"]!, toNumber,
            answerUrl: `${baseUrl}/api/webhooks/vobiz/voice?agentId=${agentId}&dir=out&corr=${vobizCorrToken}`,
            hangupUrl:  `${baseUrl}/api/webhooks/vobiz/status`,
            maxDurationSeconds,
            ...(amd.enabled && { machineDetectionEnabled: true, machineDetectionUrl: `${baseUrl}/api/webhooks/vobiz/amd?agentId=${agentId}` }),
          });
          vobizRequestUuid = dialRes.requestUuid;
          providerCallId = dialRes.callUuid ?? "";
        }
      } else {
        // ── Managed platform number — no personal number/KYC required ──


        // Load platform managed credentials
        const [authIdRow, authTokenRow, numbersRow] = await Promise.all([
          db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, "managed_vobiz_auth_id")).then(r => r[0]),
          db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, "managed_vobiz_auth_token")).then(r => r[0]),
          db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, "managed_phone_numbers")).then(r => r[0]),
        ]);

        const managedAuthId    = authIdRow?.value    || process.env["VOBIZ_AUTH_ID"];
        const managedAuthToken = authTokenRow?.value  || process.env["VOBIZ_AUTH_TOKEN"];
        const numbers: string[] = numbersRow?.value ? (JSON.parse(numbersRow.value) as string[]) : [];

        if (!managedAuthId || !managedAuthToken) {
          res.status(503).json({ error: "Managed telephony is not configured. Please add your own Vobiz provider or contact support." });
          return;
        }
        if (numbers.length === 0) {
          res.status(503).json({ error: "No managed phone numbers are configured. Please add your own Vobiz provider or contact support." });
          return;
        }

        // Trial quota: managed-pool dials only. Purchased numbers unlock unlimited.
        // Apply when the agent has no assigned owned outbound number.
        if (!agentOutboundNumber && agent.userId) {
          const { enforceManagedOutboundQuota } = await import("../services/managed-outbound-quota.js");
          const blocked = await enforceManagedOutboundQuota(agent.userId);
          if (blocked) {
            req.log.info({ agentId, userId: agent.userId, quota: blocked.body.quota }, "Managed outbound trial limit hit");
            res.status(blocked.status).json(blocked.body);
            return;
          }
        }

        // Prefer agent's assigned outbound number (from phone_numbers table — already platform-owned,
        // no need to cross-check the managed pool). Fall back to preferredManagedNumber if in pool,
        // else pick randomly from the pool.
        let fromNumber: string;
        if (agentOutboundNumber) {
          // Agent has an explicitly assigned outbound number — use it directly
          fromNumber = agentOutboundNumber;
        } else {
          const preferred = (agentCfg2["preferredManagedNumber"] as string | undefined) ?? null;
          fromNumber = (preferred && numbers.includes(preferred))
            ? preferred
            : numbers[Math.floor(Math.random() * numbers.length)]!;
        }
        effectiveFromNumber = fromNumber;
        vobizCorrToken = randomBytes(8).toString("hex");
        {
          const dialRes = await dialVobiz({
            authId: managedAuthId, authToken: managedAuthToken,
            fromNumber, toNumber,
            answerUrl: `${baseUrl}/api/webhooks/vobiz/voice?agentId=${agentId}&pt=1&dir=out&corr=${vobizCorrToken}`,
            hangupUrl:  `${baseUrl}/api/webhooks/vobiz/status`,
            maxDurationSeconds,
            ...(amd.enabled && { machineDetectionEnabled: true, machineDetectionUrl: `${baseUrl}/api/webhooks/vobiz/amd?agentId=${agentId}` }),
          });
          vobizRequestUuid = dialRes.requestUuid;
          providerCallId = dialRes.callUuid ?? "";
        }
        req.log.info({ agentId, toNumber, fromNumber, managedAuthId }, "Outbound call via managed number");
      }
    } else {
      res.status(400).json({ error: `Outbound calling is not yet supported for provider: ${provider}` });
      return;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Outbound call failed");
    res.status(400).json({ error: msg });
    return;
  }

  const executionId = `exec_${randomBytes(4).toString("hex")}`;
  const [call] = await db.insert(callsTable).values({
    agentId, toNumber, fromNumber: effectiveFromNumber, status: "ringing",
    userId: agent.userId ?? null,
    executionId,
    metadata: JSON.stringify({
      ...(providerCallId ? { providerCallId } : {}),
      provider,
      // VoBiz: dial-time placeholder is the request_uuid (correlation only). The
      // live CallUUID is written over providerCallId/externalCallId when the
      // answer-webhook WS session reconciles this row by corrToken.
      ...(vobizRequestUuid ? { requestUuid: vobizRequestUuid } : {}),
      ...(vobizCorrToken ? { corrToken: vobizCorrToken } : {}),
      ...(Object.keys(callVariables).length > 0 ? { callVariables } : {}),
    }),
  }).returning();

  await db.update(agentsTable).set({ totalCalls: agent.totalCalls + 1 }).where(eq(agentsTable.id, agentId));

  req.log.info(
    { agentId, toNumber, providerCallId, vobizRequestUuid, vobizCorrToken, variableKeys: Object.keys(callVariables) },
    "Outbound call initiated",
  );
  res.status(201).json(GetCallResponse.parse(await enrichCall(call)));
});

/* ── POST /calls/send-destination-otp ────────────────────────────────────── */

router.post("/calls/send-destination-otp", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { phoneNumber } = req.body as { phoneNumber?: string };
  if (!phoneNumber?.trim()) { res.status(400).json({ error: "phoneNumber is required" }); return; }

  const phone = phoneNumber.trim();
  if (!/^\+?[1-9]\d{6,14}$/.test(phone.replace(/[\s\-()]/g, ""))) {
    res.status(400).json({ error: "Invalid phone number format. Include country code (e.g. +91XXXXXXXXXX)." });
    return;
  }

  try {
    const otp = await generateAndStoreOtp(clerkId, phone);
    await sendBrevoSms(phone, `Your SnapServe verification code is ${otp}. Valid for 10 minutes. Do not share this with anyone.`);
    req.log.info({ clerkId, phone }, "Destination OTP sent");
    res.json({ sent: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err, clerkId, phone }, "Failed to send destination OTP");
    res.status(500).json({ error: msg });
  }
});

/* ── POST /calls/verify-destination-otp ──────────────────────────────────── */

router.post("/calls/verify-destination-otp", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { phoneNumber, otp } = req.body as { phoneNumber?: string; otp?: string };
  if (!phoneNumber?.trim() || !otp?.trim()) {
    res.status(400).json({ error: "phoneNumber and otp are required" });
    return;
  }

  const phone = phoneNumber.trim();
  const valid = await verifyDestinationOtp(clerkId, phone, otp.trim());
  if (!valid) {
    res.status(400).json({ error: "Invalid or expired OTP. Please request a new one." });
    return;
  }

  const now       = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

  // Upsert: delete any stale row then insert fresh
  await db
    .delete(verifiedPhoneDestinationsTable)
    .where(and(
      eq(verifiedPhoneDestinationsTable.userId, clerkId),
      eq(verifiedPhoneDestinationsTable.phoneNumber, phone),
    ));
  await db.insert(verifiedPhoneDestinationsTable).values({ userId: clerkId, phoneNumber: phone, expiresAt });

  req.log.info({ clerkId, phone }, "Destination phone verified");
  res.json({ verified: true, expiresAt: expiresAt.toISOString() });
});

/* ── GET /calls/verified-destinations ────────────────────────────────────── */

router.get("/calls/verified-destinations", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const now = new Date();
  const rows = await db
    .select()
    .from(verifiedPhoneDestinationsTable)
    .where(and(
      eq(verifiedPhoneDestinationsTable.userId, clerkId),
      gt(verifiedPhoneDestinationsTable.expiresAt, now),
    ))
    .orderBy(desc(verifiedPhoneDestinationsTable.verifiedAt));

  res.json(rows.map(r => ({
    phoneNumber: r.phoneNumber,
    verifiedAt:  r.verifiedAt.toISOString(),
    expiresAt:   r.expiresAt.toISOString(),
  })));
});

router.get("/calls", requireAuth, clientContext, async (req, res): Promise<void> => {
  const query = ListCallsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const clerkId = (req as any).clerkUserId as string;
  const scope = await resolveWorkspaceScope(clerkId);

  // Workspace: owner + teammates share one History list. Legacy rows with
  // null userId still match if the agent belongs to someone in the workspace.
  const ownership = workspaceCallsWhere(scope.userIds);
  const where = query.data.agentId != null
    ? and(ownership, eq(callsTable.agentId, query.data.agentId))
    : ownership;

  const calls = await db
    .select({
      call: callsTable,
      campaignId: callExecutionsTable.campaignId,
    })
    .from(callsTable)
    .leftJoin(callExecutionsTable, eq(callExecutionsTable.callId, callsTable.id))
    .where(where)
    .orderBy(desc(callsTable.createdAt));
  const enriched = await Promise.all(
    calls.map(async (row) => ({
      ...(await enrichCall(row.call, row.campaignId ?? null)),
      campaignId: row.campaignId ?? null,
    })),
  );
  const valid = [];
  for (const row of enriched) {
    const parsed = ListCallsResponseItem.safeParse(row);
    if (parsed.success) {
      valid.push(parsed.data);
      continue;
    }
    logger.warn(
      { callId: (row as { id?: number }).id, issues: parsed.error.issues.slice(0, 8) },
      "GET /calls skipped invalid row (would 500 History)",
    );
  }
  res.json(ListCallsResponse.parse(valid));
});

router.post("/calls", requireAuth, clientContext, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const parsed = InitiateCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, parsed.data.agentId));
  if (!agent) {
    res.status(400).json({ error: "Agent not found" });
    return;
  }

  if (agent.userId !== userId) {
    const scope = await resolveWorkspaceScope(userId ?? "");
    if (!userId || !agent.userId || !scope.userIds.includes(agent.userId) || !scope.canWrite) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }

  // Balance gate — block if wallet is empty
  if (agent.userId) {
    const [user] = await db.select({ walletBalanceCents: usersTable.walletBalanceCents })
      .from(usersTable).where(eq(usersTable.clerkId, agent.userId));
    if (user && user.walletBalanceCents <= 0) {
      res.status(402).json({ error: "Insufficient balance. Please top up your wallet to start calls." });
      return;
    }
  }

  // Usage limit checks
  const limitErr = await checkUsageLimits(agent);
  if (limitErr) { res.status(429).json({ error: limitErr }); return; }

  const executionId = `exec_${randomBytes(4).toString("hex")}`;
  const [call] = await db
    .insert(callsTable)
    .values({ ...parsed.data, userId: agent.userId ?? null, status: "pending", executionId })
    .returning();

  await db
    .update(agentsTable)
    .set({ totalCalls: agent.totalCalls + 1 })
    .where(eq(agentsTable.id, agent.id));

  const enriched = await enrichCall(call);
  res.status(201).json(GetCallResponse.parse(enriched));
});

router.get("/calls/:id", requireAuth, clientContext, async (req, res): Promise<void> => {
  const params = GetCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Validation failed", issues: params.error.issues });
    return;
  }
  const clerkId = (req as any).clerkUserId as string;
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, params.data.id));
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  if (!(await canAccessWorkspaceCall(clerkId, call))) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  const [exec] = await db
    .select({ campaignId: callExecutionsTable.campaignId })
    .from(callExecutionsTable)
    .where(eq(callExecutionsTable.callId, call.id));
  const enriched = {
    ...(await enrichCall(call, exec?.campaignId ?? null)),
    campaignId: exec?.campaignId ?? null,
  };
  res.json(GetCallResponse.parse(enriched));
});

/**
 * Translate this call's transcript into a preferred language (Sarvam Mayura).
 * Does not persist — returns translated content for UI display only.
 */
router.post("/calls/:id/translate-transcript", requireAuth, clientContext, async (req, res): Promise<void> => {
  const params = GetCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Validation failed", issues: params.error.issues });
    return;
  }

  const targetLanguage = String((req.body as { targetLanguage?: string } | undefined)?.targetLanguage ?? "").trim();
  const {
    isTranscriptTranslateLang,
    toSarvamTranslateTarget,
    TRANSCRIPT_TRANSLATE_LANGUAGES,
    parseTranscriptForTranslate,
    translateTranscriptLines,
    rebuildPlainTranscript,
  } = await import("../services/transcript-translate.js");

  if (!targetLanguage || !isTranscriptTranslateLang(targetLanguage)) {
    res.status(400).json({
      error: "Choose a supported target language",
      languages: TRANSCRIPT_TRANSLATE_LANGUAGES,
    });
    return;
  }

  const clerkId = (req as any).clerkUserId as string;
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, params.data.id));
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  if (!(await canAccessWorkspaceCall(clerkId, call))) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  if (!call.transcript?.trim()) {
    res.status(400).json({ error: "No transcript available for this call" });
    return;
  }

  try {
    const parsed = parseTranscriptForTranslate(call.transcript);
    if (parsed.lines.length === 0) {
      res.status(400).json({ error: "No transcript available for this call" });
      return;
    }

    const translatedLines = await translateTranscriptLines(parsed.lines, targetLanguage);
    const target = toSarvamTranslateTarget(targetLanguage);
    const label =
      TRANSCRIPT_TRANSLATE_LANGUAGES.find((l) => l.value === target)?.label ?? target;

    if (parsed.kind === "json") {
      res.json({
        targetLanguage: target,
        targetLanguageLabel: label,
        kind: "json",
        lines: translatedLines,
      });
      return;
    }

    res.json({
      targetLanguage: target,
      targetLanguageLabel: label,
      kind: "plain",
      transcript: rebuildPlainTranscript(parsed.plainLines ?? [], translatedLines),
      lines: translatedLines,
    });
  } catch (err) {
    req.log.error({ err, callId: params.data.id }, "translate-transcript failed");
    const message = err instanceof Error ? err.message : "Translation failed";
    const status = /not configured/i.test(message) ? 503 : 502;
    res.status(status).json({ error: message });
  }
});

/**
 * Fresh Recall mixed-meeting MP4 URL for call-log playback.
 * Pre-signed URLs expire — always re-fetch via recallBotId in call metadata.
 */
router.get("/calls/:id/meeting-recording", requireAuth, clientContext, async (req, res): Promise<void> => {
  const params = GetCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Validation failed", issues: params.error.issues });
    return;
  }
  const clerkId = (req as any).clerkUserId as string;
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, params.data.id));
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  if (!(await canAccessWorkspaceCall(clerkId, call))) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  let meta: Record<string, unknown> = {};
  try {
    meta = call.metadata ? (JSON.parse(call.metadata) as Record<string, unknown>) : {};
  } catch {
    meta = {};
  }
  const botId = typeof meta["recallBotId"] === "string" ? meta["recallBotId"].trim() : "";
  if (!botId) {
    res.status(404).json({ error: "No meeting recording for this call" });
    return;
  }
  const { fetchRecallBotMixedVideoUrl, isRecallConfigured } = await import("../services/meet-bots.js");
  if (!(await isRecallConfigured())) {
    res.status(503).json({ error: "Meeting recording is not configured" });
    return;
  }

  try {
    const url = await fetchRecallBotMixedVideoUrl(botId);
    if (!url) {
      res.status(404).json({
        error: "Meeting recording is not ready yet — try again shortly",
        pending: true,
      });
      return;
    }
    // Mark ready if we hadn't yet (late playback after processing finished).
    if (meta["recallVideoReady"] !== true) {
      await db
        .update(callsTable)
        .set({
          metadata: JSON.stringify({ ...meta, recallVideoReady: true, recallBotId: botId }),
        })
        .where(eq(callsTable.id, call.id));
    }
    res.json({ url, botId });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Failed to fetch meeting recording",
    });
  }
});

/**
 * Fresh per-participant meeting audio tracks (Recall audio_separate MP3 parts).
 * Pre-signed URLs expire — re-fetch on each request.
 */
router.get("/calls/:id/meeting-separate-audio", requireAuth, clientContext, async (req, res): Promise<void> => {
  const params = GetCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Validation failed", issues: params.error.issues });
    return;
  }
  const clerkId = (req as any).clerkUserId as string;
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, params.data.id));
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  if (!(await canAccessWorkspaceCall(clerkId, call))) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  let meta: Record<string, unknown> = {};
  try {
    meta = call.metadata ? (JSON.parse(call.metadata) as Record<string, unknown>) : {};
  } catch {
    meta = {};
  }
  const botId = typeof meta["recallBotId"] === "string" ? meta["recallBotId"].trim() : "";
  if (!botId) {
    res.status(404).json({ error: "No meeting audio for this call" });
    return;
  }
  const { fetchRecallBotSeparateAudioTracks, isRecallConfigured } = await import("../services/meet-bots.js");
  if (!(await isRecallConfigured())) {
    res.status(503).json({ error: "Meeting recording is not configured" });
    return;
  }

  try {
    const result = await fetchRecallBotSeparateAudioTracks(botId);
    if (!result?.tracks.length) {
      res.status(404).json({
        error: "Per-speaker audio is not ready yet — try again shortly",
        pending: true,
      });
      return;
    }
    if (meta["recallSeparateAudioReady"] !== true) {
      await db
        .update(callsTable)
        .set({
          metadata: JSON.stringify({
            ...meta,
            recallSeparateAudioReady: true,
            recallSeparateAudioCount: result.tracks.length,
            recallRecordingId: result.recordingId,
            recallBotId: botId,
          }),
        })
        .where(eq(callsTable.id, call.id));
    }
    res.json({
      botId,
      recordingId: result.recordingId,
      tracks: result.tracks.map((t) => ({
        name: t.name,
        participantId: t.participantId,
        isHost: t.isHost,
        url: t.downloadUrl,
      })),
    });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Failed to fetch per-speaker audio",
    });
  }
});

// Caller-scoped memory context for the caller on a given call. Mirrors the
// runtime caller-key derivation (orchestration/session.ts) so the Call Log
// detail page shows the SAME memory the live pipeline reads/writes.
router.get("/calls/:id/caller-memory", requireAuth, clientContext, async (req, res): Promise<void> => {
  const params = GetCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Validation failed", issues: params.error.issues });
    return;
  }
  const clerkId = (req as any).clerkUserId as string;
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, params.data.id));
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  // Ownership check identical to GET /calls/:id.
  if (!(await canAccessWorkspaceCall(clerkId, call))) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  // Resolve the SAME memory key the call session used. Sessions persist the
  // resolved key (and direction) into the call metadata, so prefer that — it can
  // never drift from what was actually written. For legacy rows written before
  // keys were persisted, fall back to a direction-aware (or, last resort,
  // direction-blind) derivation from the stored from/to numbers.
  const fromNumber = call.fromNumber ?? "";
  const toNumber = call.toNumber ?? "";
  let callerKey: string | null = null;
  let metaDirection: "inbound" | "outbound" | null = null;
  try {
    const md = JSON.parse(call.metadata ?? "{}") as Record<string, unknown>;
    if (typeof md["callerKey"] === "string" && md["callerKey"]) {
      callerKey = canonicalizeCallerKey(md["callerKey"] as string);
    }
    if (md["direction"] === "inbound" || md["direction"] === "outbound") {
      metaDirection = md["direction"];
    }
  } catch { /* ignore malformed metadata */ }
  if (!callerKey) {
    if (fromNumber.startsWith("webcall-user-")) {
      callerKey = canonicalizeCallerKey(fromNumber);
    } else if (metaDirection) {
      callerKey = resolveCallerKey(metaDirection, fromNumber, toNumber);
    } else {
      callerKey = canonicalizeCallerKey(humanPhone(fromNumber, toNumber));
    }
  }

  if (!callerKey) {
    res.json(GetCallCallerMemoryResponse.parse({
      phoneNumber: null,
      name: null,
      summary: null,
      callCount: 0,
      factCount: 0,
      episodeCount: 0,
      facts: [],
      episodes: [],
    }));
    return;
  }

  const [profileRows, allFacts, allEpisodes] = await Promise.all([
    db.select().from(callerProfilesTable)
      .where(and(eq(callerProfilesTable.agentId, call.agentId), eq(callerProfilesTable.phoneNumber, callerKey)))
      .limit(1),
    db.select().from(callerFactsTable)
      .where(and(eq(callerFactsTable.agentId, call.agentId), eq(callerFactsTable.phoneNumber, callerKey)))
      .orderBy(desc(callerFactsTable.createdAt)),
    db.select().from(callerCallArchiveTable)
      .where(and(eq(callerCallArchiveTable.agentId, call.agentId), eq(callerCallArchiveTable.phoneNumber, callerKey)))
      .orderBy(desc(callerCallArchiveTable.createdAt))
      .limit(20),
  ]);

  const profile = profileRows[0];
  const currentFacts = allFacts.filter(f => f.supersededById === null);

  const facts = currentFacts.map(f => ({
    id:                f.id,
    key:               f.key,
    value:             f.value,
    confidence:        f.confidence,
    sourceCallId:      f.sourceCallId,
    sourceSentenceIds: [] as number[],
    createdAt:         f.createdAt,
    history:           [] as Array<{ id: number; value: string; confidence: number; createdAt: Date }>,
  }));

  const episodes = allEpisodes.map(ep => ({
    id:              ep.id,
    callId:          ep.callId,
    summary:         ep.summary,
    sentiment:       ep.sentiment ?? null,
    durationSeconds: ep.durationSeconds,
    createdAt:       ep.createdAt,
    insightFactIds:  [] as number[],
    sentences:       [] as Array<{ id: number; sequenceNum: number; speaker: string; text: string }>,
  }));

  res.json(GetCallCallerMemoryResponse.parse({
    phoneNumber:  callerKey,
    name:         profile?.name ?? null,
    summary:      profile?.summary ?? null,
    callCount:    profile?.callCount ?? allEpisodes.length,
    factCount:    currentFacts.length,
    episodeCount: allEpisodes.length,
    facts,
    episodes,
  }));
});

router.patch("/calls/:id", requireAuth, clientContext, async (req, res): Promise<void> => {
  const params = UpdateCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Validation failed", issues: params.error.issues });
    return;
  }
  const parsed = UpdateCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const { userId } = getAuth(req);

  // Ownership check: load the call and verify it belongs to the authenticated user
  const [existing] = await db.select({ userId: callsTable.userId, agentId: callsTable.agentId })
    .from(callsTable).where(eq(callsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  if (!userId || !(await canAccessWorkspaceCall(userId, existing))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  {
    const scope = await resolveWorkspaceScope(userId);
    if (!scope.canWrite) {
      res.status(403).json({ error: "Your team role cannot edit calls" });
      return;
    }
  }

  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.endedAt) {
    updateData.endedAt = new Date(parsed.data.endedAt);
  }

  const [call] = await db
    .update(callsTable)
    .set(updateData)
    .where(eq(callsTable.id, params.data.id))
    .returning();

  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  const enriched = await enrichCall(call);
  res.json(UpdateCallResponse.parse(enriched));
});

/* ── POST /calls/:id/transfer (P2-A) ─────────────────────────────────────── */

router.post("/calls/:id/transfer", requireAuth, clientContext, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid call id" }); return; }

  const { type, target, warmMessage, webhookBaseUrl } = req.body as {
    type?: unknown; target?: unknown; warmMessage?: unknown; webhookBaseUrl?: unknown;
  };

  if (type !== "warm" && type !== "cold") {
    res.status(400).json({ error: 'type must be "warm" or "cold"' }); return;
  }
  if (typeof target !== "string" || !target.trim()) {
    res.status(400).json({ error: "target is required" }); return;
  }

  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, id));
  if (!call) { res.status(404).json({ error: "Call not found" }); return; }
  if (call.status !== "in_progress" && call.status !== "ringing") {
    res.status(409).json({ error: `Call is not active (status: ${call.status})` }); return;
  }

  // Resolve VoBiz credentials from the agent's telephony provider row
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, call.agentId));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  const telephonyProv = agent.telephonyProvider.toLowerCase();
  if (telephonyProv !== "vobiz") {
    res.status(400).json({ error: `Call transfer is currently supported for VoBiz only (agent uses: ${telephonyProv})` });
    return;
  }

  const [provRow] = await db.select().from(providersTable)
    .where(and(
      eq(providersTable.providerName, "vobiz"),
      eq(providersTable.userId, agent.userId!),
      eq(providersTable.isActive, true),
    )).limit(1);
  if (!provRow) {
    res.status(400).json({ error: 'No VoBiz provider configured. Add one on the Providers page.' });
    return;
  }
  const cfg = provRow.extraConfig ? JSON.parse(provRow.extraConfig) as Record<string, string> : {};
  const authId = cfg["authId"] ?? process.env["VOBIZ_AUTH_ID"] ?? "";
  if (!authId) {
    res.status(400).json({ error: 'VoBiz provider missing "authId" in Extra Config.' }); return;
  }

  const baseUrl = resolveWebhookBase(req, typeof webhookBaseUrl === "string" ? webhookBaseUrl : undefined);
  const encodedTarget = encodeURIComponent(target.trim());
  // VoBiz needs a callerId (a VoBiz-provisioned number on the account) on the
  // <Dial> to the human agent. The provider's configured fromNumber is that
  // number; without it the outbound bridge is rejected and the caller dropped.
  const platformCallerId = cfg["fromNumber"];
  const callerIdQs = platformCallerId ? `&callerId=${encodeURIComponent(platformCallerId)}` : "";
  const xmlCallbackUrl = `${baseUrl}/api/webhooks/vobiz/transfer-xml?target=${encodedTarget}${callerIdQs}`;

  const handoffMsg = typeof warmMessage === "string" && warmMessage.trim()
    ? warmMessage.trim()
    : "Please hold while I connect you to an agent.";

  try {
    const transferred = await triggerTransfer(
      id, type, target.trim(), handoffMsg, xmlCallbackUrl, authId, decryptKey(provRow.apiKey),
    );
    if (!transferred) {
      req.log.warn({ callId: id }, "Transfer: no external call ID — cannot redirect (inbound call without externalCallId)");
      res.status(409).json({ error: "Transfer could not be initiated — call is not connected to the telephony provider yet." });
      return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err, callId: id }, "Transfer failed");
    res.status(400).json({ error: msg }); return;
  }

  // Update call record
  const [updated] = await db.update(callsTable).set({
    transferType: type,
    transferTarget: target.trim(),
    status: "transferred",
    endedAt: new Date(),
  }).where(eq(callsTable.id, id)).returning();

  // Log transfer in supervisor table (fire-and-forget)
  const callUserId = call.userId ?? null;
  if (callUserId) {
    db.insert(callTransfersTable).values({
      callId:      id,
      userId:      callUserId,
      transferTo:  target.trim(),
      transferName:typeof warmMessage === "string" ? warmMessage.trim() || null : null,
      summary:     typeof warmMessage === "string" ? warmMessage.trim() || null : null,
      status:      "initiated",
    }).catch((e: unknown) => req.log.warn({ e }, "Failed to log call transfer"));
  }

  res.json(await enrichCall(updated ?? call));
});

router.patch("/calls/:id/end", requireAuth, clientContext, async (req, res): Promise<void> => {
  const params = EndCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Validation failed", issues: params.error.issues });
    return;
  }

  const { userId } = getAuth(req);

  const [existing] = await db.select().from(callsTable).where(eq(callsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  // Ownership check — prevent cross-tenant billing manipulation
  if (!userId || !(await canAccessWorkspaceCall(userId, existing))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  {
    const scope = await resolveWorkspaceScope(userId);
    if (!scope.canWrite) {
      res.status(403).json({ error: "Your team role cannot edit calls" });
      return;
    }
  }

  const endedAt = new Date();
  // Runaway guard: a web call is timed from record creation, so a browser tab
  // left open (never firing this end call promptly) would otherwise report — and
  // bill — many hours. Cap at 4h; a single real conversation never runs that long.
  const MAX_CALL_DURATION_SECONDS = 4 * 60 * 60;
  const durationSeconds = Math.min(
    Math.floor((endedAt.getTime() - existing.createdAt.getTime()) / 1000),
    MAX_CALL_DURATION_SECONDS,
  );

  // Parse optional latency payload
  const latency = parseLatencyBody(req.body);

  // Fetch agent early — needed for rate lookup and metrics update
  const [agentForBilling] = await db.select().from(agentsTable).where(eq(agentsTable.id, existing.agentId));

  // Flat per-minute rate: ₹5/min for both managed and BYOP (in INR paise).
  // Mode is resolved dynamically: if the user has their own provider keys for any
  // of this agent's providers → BYOP; otherwise → managed (platform keys in use).
  // Skip billing when costCents is already set (endSession handled it for
  // telephony calls that end via WebSocket close, not this HTTP route).
  const alreadyBilled = existing.costCents != null && existing.costCents > 0;
  const callClerkId = existing.userId ?? agentForBilling?.userId ?? null;
  const billingMode = alreadyBilled ? "managed" : await resolveAgentBillingMode(callClerkId, agentForBilling ?? {});
  // Partner-managed clients bill at their partner-set rate; the spread over the
  // partner's base rate is credited to the partner after the debit below.
  const partnerBilling = alreadyBilled ? null : await resolvePartnerBilling(callClerkId);
  const ownTelephonyDiscount = alreadyBilled ? 0 : await resolveOwnTelephonyDiscount(callClerkId, agentForBilling ?? {});
  const rateCentsPerMin = partnerBilling?.clientRateCentsPerMin
    ?? Math.max(0, (await resolveBillingRateCentsPerMin(billingMode)) - ownTelephonyDiscount);
  const modeLabel = partnerBilling ? "partner" : billingMode === "managed" ? "managed" : "BYOP";
  const rateLabel = `₹${(rateCentsPerMin / 100).toFixed(2)}/min (${modeLabel})`;
  // Per-second pro-rata (never ceil to a full minute). 9s @ ₹5/min → ₹0.75.
  const debitCents = alreadyBilled || durationSeconds <= 0
    ? 0
    : computeProRataDebitCents(durationSeconds, rateCentsPerMin);

  // NOTE: costCents is deliberately NOT set here — it is written by the
  // atomic billing claim below so racing end paths can't both bill.
  const callUpdateSet: Partial<typeof callsTable.$inferInsert> = {
    status: "completed",
    endedAt,
    durationSeconds,
  };
  if (latency.sttLatencyMs != null) callUpdateSet.sttLatencyMs = latency.sttLatencyMs;
  if (latency.llmLatencyMs != null) callUpdateSet.llmLatencyMs = latency.llmLatencyMs;
  if (latency.ttsFirstChunkMs != null) callUpdateSet.ttsFirstChunkMs = latency.ttsFirstChunkMs;

  const [call] = await db
    .update(callsTable)
    .set(callUpdateSet)
    .where(eq(callsTable.id, params.data.id))
    .returning();

  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  const agent = agentForBilling;
  if (agent) {
    const prevCount = agent.successfulCalls;
    const newSuccessful = prevCount + 1;

    function rollingAvg(prev: number | null, prevN: number, next: number | null | undefined): number | undefined {
      if (next == null) return prev ?? undefined;
      return prev != null
        ? Math.floor((prev * prevN + next) / newSuccessful)
        : next;
    }

    const newAvgDuration = agent.avgDurationSeconds != null
      ? Math.floor((agent.avgDurationSeconds * prevCount + durationSeconds) / newSuccessful)
      : durationSeconds;

    await db.update(agentsTable).set({
      successfulCalls:  newSuccessful,
      avgDurationSeconds: newAvgDuration,
      avgSttLatencyMs:  rollingAvg(agent.avgSttLatencyMs, prevCount, latency.sttLatencyMs),
      avgLlmLatencyMs:  rollingAvg(agent.avgLlmLatencyMs, prevCount, latency.llmLatencyMs),
      avgTtsFirstChunkMs: rollingAvg(agent.avgTtsFirstChunkMs, prevCount, latency.ttsFirstChunkMs),
    }).where(eq(agentsTable.id, agent.id));
  }

  // Deduct platform fee and check autopay trigger.
  // Atomic billing claim: flip costCents from unset→set in ONE conditional
  // UPDATE — only the winner debits the wallet and credits partner spread
  // (the WS endSession path in orchestration/session.ts can race this route
  // on the same call; a pre-read check alone lets both paths bill).
  const callUserId = call.userId ?? agent?.userId ?? null;
  let billingClaimed = false;
  if (callUserId && debitCents > 0) {
    const claimed = await db.update(callsTable)
      .set({ costCents: debitCents })
      .where(and(
        eq(callsTable.id, call.id),
        or(isNull(callsTable.costCents), lte(callsTable.costCents, 0)),
      ))
      .returning({ id: callsTable.id });
    billingClaimed = claimed.length > 0;
    if (!billingClaimed) {
      req.log.info({ callId: call.id }, "Billing already claimed by another end path — skipping debit");
    }
  }
  if (callUserId && debitCents > 0 && billingClaimed) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, callUserId));
    if (user) {
      // Atomic in-DB decrement (GREATEST clamps at 0) so two calls debiting the
      // same wallet concurrently never overwrite each other's write (lost update).
      const [updatedUser] = await db.update(usersTable)
        .set({ walletBalanceCents: sql`GREATEST(0, ${usersTable.walletBalanceCents} - ${debitCents})` })
        .where(eq(usersTable.id, user.id))
        .returning({ walletBalanceCents: usersTable.walletBalanceCents });
      const newBalance = updatedUser?.walletBalanceCents ?? Math.max(0, user.walletBalanceCents - debitCents);
      await db.insert(walletTransactionsTable).values({
        userId:      user.id,
        type:        "call_debit",
        amountCents: -debitCents,
        description: `Call #${call.id} — ${durationSeconds}s @ ${rateLabel}`,
        status:      "completed",
        callId:      call.id,
      });

      // Partner spread — credit the client's partner with (client rate − base rate).
      if (partnerBilling) {
        try {
          const spreadCents = await creditPartnerSpreadOnCall({
            partner: partnerBilling,
            callId: call.id,
            durationSeconds,
            debitCents,
          });
          if (spreadCents > 0) {
            req.log.info({ callId: call.id, partnerId: partnerBilling.partnerId, spreadCents }, "Partner spread credited");
          }
        } catch (spreadErr) {
          req.log.error({ spreadErr, callId: call.id, partnerId: partnerBilling.partnerId }, "Partner spread credit failed");
        }
      }

      // Autopay trigger: balance dropped below threshold — fire real debit
      if (user.autoPayEnabled && newBalance < user.autoPayThresholdCents) {
        req.log.info(
          { userId: callUserId, newBalance, threshold: user.autoPayThresholdCents, topUpAmount: user.autoPayAmountCents },
          "Autopay threshold triggered",
        );
        import("../services/wallet-auto-debit.js").then(({ triggerAutoDebit }) => {
          triggerAutoDebit(user.id, callUserId, user.autoPayAmountCents).catch((err) => {
            req.log.error({ err, userId: callUserId }, "Auto-debit fire-and-forget error");
          });
        }).catch(() => {});
      }
    }
  }

  // Disposition first, then webhooks with the full enriched payload.
  // Fire-and-forget wrapper so the HTTP response is not blocked, but order inside
  // is awaited so dispositionResult is present when webhooks fire.
  void (async () => {
    let dispositionResult: Record<string, unknown> | null =
      (call.dispositionResult as Record<string, unknown> | null) ?? null;
    try {
      if (!dispositionResult) {
        const taxResult = await disposeCall({
          agentId: call.agentId,
          callId: call.id,
          transcript: call.transcript ?? null,
          callEvents: [],
          callStartedAt: call.createdAt ?? null,
          calledNumber: call.toNumber ?? null,
        });
        dispositionResult = flatDispositionFromTaxonomy(taxResult) ?? dispositionResult;
      }
    } catch {
      /* disposition optional */
    }

    const [fresh] = await db.select().from(callsTable).where(eq(callsTable.id, call.id)).limit(1);
    const status = String(fresh?.status ?? call.status ?? "completed");
    const payload = buildCallEndedWebhookPayload({
      callId: call.id,
      executionId: fresh?.executionId ?? call.executionId ?? null,
      agentId: call.agentId,
      agentName: agent?.name ?? null,
      status,
      fromNumber: fresh?.fromNumber ?? call.fromNumber ?? null,
      toNumber: fresh?.toNumber ?? call.toNumber ?? null,
      durationSeconds: fresh?.durationSeconds ?? durationSeconds,
      costCents: fresh?.costCents ?? debitCents ?? null,
      transcript: fresh?.transcript ?? call.transcript ?? null,
      callSummary: fresh?.callSummary ?? call.callSummary ?? null,
      dispositionResult:
        dispositionResult
        ?? (fresh?.dispositionResult as Record<string, unknown> | null)
        ?? null,
      successEvaluation: fresh?.successEvaluation ?? call.successEvaluation ?? null,
      recordingUrl: fresh?.recordingUrl ?? call.recordingUrl ?? null,
      recordingError: fresh?.recordingError ?? call.recordingError ?? null,
      amdResult: fresh?.amdResult ?? call.amdResult ?? null,
      transferType: fresh?.transferType ?? call.transferType ?? null,
      transferTarget: fresh?.transferTarget ?? call.transferTarget ?? null,
      conversationCompleted: fresh?.conversationCompleted ?? call.conversationCompleted ?? null,
      primaryLanguage: fresh?.primaryLanguage ?? call.primaryLanguage ?? null,
      memoryRecognized: fresh?.memoryRecognized ?? call.memoryRecognized ?? null,
      errorMessage: fresh?.errorMessage ?? call.errorMessage ?? null,
      tokensSaved: fresh?.tokensSaved ?? call.tokensSaved ?? null,
      avgSttLatencyMs: fresh?.sttLatencyMs ?? null,
      avgLlmLatencyMs: fresh?.llmLatencyMs ?? null,
      avgTtsLatencyMs: fresh?.ttsFirstChunkMs ?? null,
      createdAt: fresh?.createdAt ?? call.createdAt ?? null,
      endedAt: fresh?.endedAt ?? new Date(),
      metadata: fresh?.metadata ?? call.metadata ?? null,
    });

    if (callUserId) {
      const event = status === "failed" ? "call.failed" as const : "call.completed" as const;
      dispatchWebhooks(callUserId, event, payload).catch(() => {});
    }

    // Agent webhook URL (if set on agent) — default or custom JSON; HMAC if secret set
    if (agent?.webhookUrl) {
      const agentCfg = (agent.agentConfig ?? {}) as Record<string, unknown>;
      const serialized = serializeAgentWebhookBody(
        readWebhookPayloadTemplate(agentCfg),
        payload,
      );
      if (serialized.error) {
        req.log.warn(
          { callId: call.id, error: serialized.error },
          "Post-call notify template invalid — sending default payload",
        );
      }
      const secret = typeof agentCfg["webhookSecret"] === "string" ? agentCfg["webhookSecret"] : undefined;
      fetch(agent.webhookUrl, {
        method: "POST",
        headers: buildAgentNotifyHeaders(serialized.bodyStr, serialized.mode, secret),
        body: serialized.bodyStr,
        signal: AbortSignal.timeout(10_000),
      }).catch(() => {});
    }

    import("../services/crm/writeback.js").then(({ writeCrmCallOutcome }) => {
      writeCrmCallOutcome(call.id).catch(() => {});
    }).catch(() => {});

    import("../services/campaign-lead-transfer.js").then(({ maybeTransferCampaignLead }) => {
      maybeTransferCampaignLead({
        callId: call.id,
        dispositionResult: (payload["dispositionResult"] as Record<string, unknown> | null) ?? null,
        callSummary: (payload["callSummary"] as string | null) ?? null,
      }).catch(() => {});
    }).catch(() => {});

    import("../services/sheets-writeback.js").then(({ writeSheetAutoCallResults }) => {
      writeSheetAutoCallResults(call.id, {
        callSummary: (payload["callSummary"] as string | null) ?? null,
        dispositionResult: (payload["dispositionResult"] as Record<string, unknown> | null) ?? null,
      }).catch(() => {});
    }).catch(() => {});

    import("../services/agent-after-call-messages.js").then(({ maybeRunAgentAfterCallMessages }) => {
      maybeRunAgentAfterCallMessages({
        callId: call.id,
        agentId: call.agentId,
        dispositionResult: (payload["dispositionResult"] as Record<string, unknown> | null) ?? null,
        callSummary: (payload["callSummary"] as string | null) ?? null,
      }).then((agentMsg) => {
        if (!agentMsg.configured) {
          import("../services/whatsapp/outbound.js").then(({ dispatchWhatsappCallEnded }) => {
            dispatchWhatsappCallEnded(call.id, {
              callSummary: (payload["callSummary"] as string | null) ?? null,
              dispositionResult: (payload["dispositionResult"] as Record<string, unknown> | null) ?? null,
            }).catch(() => {});
          }).catch(() => {});
        }
      }).catch(() => {});
    }).catch(() => {});

    import("../services/campaign-after-call.js").then(({ maybeRunAfterCallBranches }) => {
      maybeRunAfterCallBranches({
        callId: call.id,
        dispositionResult: (payload["dispositionResult"] as Record<string, unknown> | null) ?? null,
        callSummary: (payload["callSummary"] as string | null) ?? null,
      }).catch(() => {});
    }).catch(() => {});

    import("../services/zelto.js").then(({ pushCallToZelto }) => {
      const endedAt = new Date().toISOString();
      const startedAt = durationSeconds
        ? new Date(Date.now() - durationSeconds * 1000).toISOString()
        : undefined;
      pushCallToZelto({
        callId: call.id,
        agentId: call.agentId,
        status: call.status ?? undefined,
        direction: (call as any).direction ?? "inbound",
        fromNumber: call.fromNumber ?? null,
        toNumber: call.toNumber ?? null,
        durationSeconds,
        startedAt,
        endedAt,
        costCents: debitCents ?? null,
        transcript: call.transcript ?? null,
        callSummary: (payload["callSummary"] as string | null) ?? null,
        dispositionResult: (payload["dispositionResult"] as Record<string, unknown> | null) ?? null,
      }).catch(() => {});
    }).catch(() => {});
  })();

  const enriched = await enrichCall(call);
  res.json(EndCallResponse.parse(enriched));
});

// ── GET /calls/:id/logs — per-call event log ──────────────────────────────
router.get("/calls/:id/logs", requireAuth, clientContext, async (req, res) => {
  const callId = parseInt(String(req.params.id), 10);
  if (isNaN(callId)) { res.status(400).json({ error: "Invalid call id" }); return; }

  const clerkId = (req as any).clerkUserId as string;

  // Verify the call belongs to the authenticated user
  const [call] = await db.select({ id: callsTable.id, userId: callsTable.userId, agentId: callsTable.agentId })
    .from(callsTable).where(eq(callsTable.id, callId));
  if (!call) { res.status(404).json({ error: "Call not found" }); return; }
  if (!(await canAccessWorkspaceCall(clerkId, call))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const events = await db.select().from(executionLogsTable)
    .where(eq(executionLogsTable.callId, callId))
    .orderBy(executionLogsTable.ts);

  res.json(events);
});


export default router;

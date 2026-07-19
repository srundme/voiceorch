import { Router, type IRouter } from "express";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { randomBytes } from "crypto";
import { eq, desc, and, or, sql, gte, gt, isNull, inArray } from "drizzle-orm";
import { db, callsTable, callEventsTable, executionLogsTable, agentsTable, providersTable, usersTable, walletTransactionsTable, activityLogsTable, callTransfersTable, vobizAccountsTable, verifiedPhoneDestinationsTable, platformSettingsTable, phoneNumbersTable, callerProfilesTable, callerFactsTable, callerCallArchiveTable, callExecutionsTable, canonicalizeCallerKey, humanPhone, resolveCallerKey } from "@workspace/db";
import { getFlatRateCentsPerMin, resolveAgentBillingMode } from "../services/minute-rates.js";
import {
  InitiateCallBody,
  InitiateOutboundCallBody,
  UpdateCallBody,
  GetCallParams,
  UpdateCallParams,
  EndCallParams,
  ListCallsQueryParams,
  ListCallsResponse,
  GetCallResponse,
  GetCallCallerMemoryResponse,
  UpdateCallResponse,
  EndCallResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth.js";
import { getAuth } from "../lib/auth-compat.js";
import { dispatchWebhooks } from "./webhook-endpoints.js";
import { disposeCall } from "../services/disposition.js";
import { traiPreDialCheck, logPreDialDecision } from "../services/trai/index.js";
import { evaluateIrdaiGate, IRDAI_BLOCKED_MESSAGE, IRDAI_BLOCKED_CODE } from "../services/irdai/gate.js";

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
import { triggerTransfer } from "../orchestration/session.js";
import { sendBrevoSms } from "../services/brevo.js";
import { generateAndStoreOtp, verifyDestinationOtp } from "../services/phone-otp.js";

/* ── POST /calls/outbound ─────────────────────────────────────────────────── */

router.post("/calls/outbound", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const parsed = InitiateOutboundCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }
  const { agentId, toNumber, webhookBaseUrl } = parsed.data;

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  if (agent.userId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
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
      const agentRate = getFlatRateCentsPerMin(billingMode);
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
        accountSid: cfg["accountSid"]!, authToken: providerRow!.apiKey,
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
        authId: cfg["authId"]!, authToken: providerRow!.apiKey,
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
            authId: cfg["authId"]!, authToken: providerRow!.apiKey,
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
        if (agent.userId) {
          const [kycAccount] = await db
            .select({ kycStatus: vobizAccountsTable.kycStatus })
            .from(vobizAccountsTable)
            .where(eq(vobizAccountsTable.userId, agent.userId));
          const hasKyc = kycAccount?.kycStatus === "completed";

          if (!hasKyc) {
            // Without KYC the destination must have been OTP-verified first
            const now = new Date();
            const [verified] = await db
              .select()
              .from(verifiedPhoneDestinationsTable)
              .where(and(
                eq(verifiedPhoneDestinationsTable.userId, agent.userId),
                eq(verifiedPhoneDestinationsTable.phoneNumber, toNumber),
                gt(verifiedPhoneDestinationsTable.expiresAt, now),
              ));
            if (!verified) {
              res.status(403).json({
                error: "Please verify the destination number via OTP before calling without KYC.",
                code: "DESTINATION_UNVERIFIED",
              });
              return;
            }
          }
        }

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
    }),
  }).returning();

  await db.update(agentsTable).set({ totalCalls: agent.totalCalls + 1 }).where(eq(agentsTable.id, agentId));

  req.log.info({ agentId, toNumber, providerCallId, vobizRequestUuid, vobizCorrToken }, "Outbound call initiated");
  res.status(201).json(GetCallResponse.parse(await enrichCall(call)));
});

/* ── POST /calls/send-destination-otp ────────────────────────────────────── */

router.post("/calls/send-destination-otp", requireAuth, async (req, res): Promise<void> => {
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

router.post("/calls/verify-destination-otp", requireAuth, async (req, res): Promise<void> => {
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

router.get("/calls/verified-destinations", requireAuth, async (req, res): Promise<void> => {
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

router.get("/calls", requireAuth, async (req, res): Promise<void> => {
  const query = ListCallsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const clerkId = (req as any).clerkUserId as string;

  // Ownership: rows the user directly owns, plus legacy/live-call rows where
  // userId is null but the call's agent belongs to the requester (mirrors the
  // fallback used by GET /calls/:id). Keeps the optional agentId filter intact.
  const ownedAgentIds = db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(eq(agentsTable.userId, clerkId));
  const ownership = or(
    eq(callsTable.userId, clerkId),
    and(isNull(callsTable.userId), inArray(callsTable.agentId, ownedAgentIds)),
  );
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
  res.json(ListCallsResponse.parse(enriched));
});

router.post("/calls", requireAuth, async (req, res): Promise<void> => {
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

  // Ownership: only the agent's owner may create call records under it
  if (agent.userId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
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

router.get("/calls/:id", requireAuth, async (req, res): Promise<void> => {
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
  // Ownership check: call.userId must match the requester, or (for legacy rows
  // where userId is null) the call's agent must belong to the requester.
  if (call.userId && call.userId !== clerkId) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  if (!call.userId) {
    const [agent] = await db.select({ userId: agentsTable.userId })
      .from(agentsTable).where(eq(agentsTable.id, call.agentId));
    if (agent?.userId && agent.userId !== clerkId) {
      res.status(404).json({ error: "Call not found" });
      return;
    }
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

// Caller-scoped memory context for the caller on a given call. Mirrors the
// runtime caller-key derivation (orchestration/session.ts) so the Call Log
// detail page shows the SAME memory the live pipeline reads/writes.
router.get("/calls/:id/caller-memory", requireAuth, async (req, res): Promise<void> => {
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
  if (call.userId && call.userId !== clerkId) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  if (!call.userId) {
    const [agent] = await db.select({ userId: agentsTable.userId })
      .from(agentsTable).where(eq(agentsTable.id, call.agentId));
    if (agent?.userId && agent.userId !== clerkId) {
      res.status(404).json({ error: "Call not found" });
      return;
    }
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

router.patch("/calls/:id", requireAuth, async (req, res): Promise<void> => {
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
  if (existing.userId && existing.userId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (!existing.userId) {
    const [agent] = await db.select({ userId: agentsTable.userId })
      .from(agentsTable).where(eq(agentsTable.id, existing.agentId));
    if (agent?.userId && agent.userId !== userId) {
      res.status(403).json({ error: "Forbidden" });
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

router.post("/calls/:id/transfer", requireAuth, async (req, res): Promise<void> => {
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
      id, type, target.trim(), handoffMsg, xmlCallbackUrl, authId, provRow.apiKey,
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

router.patch("/calls/:id/end", requireAuth, async (req, res): Promise<void> => {
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
  if (existing.userId && existing.userId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (!existing.userId) {
    const [agent] = await db.select({ userId: agentsTable.userId })
      .from(agentsTable).where(eq(agentsTable.id, existing.agentId));
    if (agent?.userId && agent.userId !== userId) {
      res.status(403).json({ error: "Forbidden" });
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
  const rateCentsPerMin = getFlatRateCentsPerMin(billingMode);
  const modeLabel = billingMode === "managed" ? "managed" : "BYOP";
  const billableMinutes = durationSeconds <= 0 ? 0 : Math.ceil(durationSeconds / 60);
  const rateLabel = `₹${(rateCentsPerMin / 100).toFixed(3)}/min (${modeLabel})`;
  const debitCents = alreadyBilled || durationSeconds <= 0
    ? 0
    : Math.round(billableMinutes * rateCentsPerMin);

  const callUpdateSet: Partial<typeof callsTable.$inferInsert> = {
    status: "completed",
    endedAt,
    durationSeconds,
    ...(debitCents > 0 ? { costCents: debitCents } : {}),
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

  // Deduct platform fee and check autopay trigger
  const callUserId = call.userId ?? agent?.userId ?? null;
  if (callUserId && debitCents > 0) {
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
        description: `Call #${call.id} — ${billableMinutes} min × ${rateLabel}`,
        status:      "completed",
        callId:      call.id,
      });

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

  // Fire call.completed webhook (fire-and-forget). Legacy subscribers to call.ended still match.
  if (callUserId) {
    const status = String(call.status ?? "completed");
    const event = status === "failed" ? "call.failed" as const : "call.completed" as const;
    dispatchWebhooks(callUserId, event, {
      callId: call.id,
      agentId: call.agentId,
      status,
      toNumber: call.toNumber ?? null,
      fromNumber: call.fromNumber ?? null,
      durationSeconds,
      costCents: debitCents,
      transcript: call.transcript ?? null,
      callSummary: call.callSummary ?? null,
      dispositionResult: call.dispositionResult ?? null,
      recordingUrl: call.recordingUrl ?? null,
    }).catch(() => {});
  }

  // Fire disposition extraction (fire-and-forget — never blocks webhook response)
  disposeCall({
    agentId:    call.agentId,
    callId:     call.id,
    transcript: call.transcript ?? null,
    callEvents: [],
  }).catch(() => {});

  // CRM writeback (fire-and-forget — push call outcome to HubSpot/Zoho if lead was CRM-sourced)
  import("../services/crm/writeback.js").then(({ writeCrmCallOutcome }) => {
    writeCrmCallOutcome(call.id).catch(() => {});
  }).catch(() => {});

  // Google Sheets writeback (fire-and-forget — call_log append + outcome upsert)
  import("../services/sheets-writeback.js").then(({ writeSheetsCallLog, writeSheetsOutcome }) => {
    writeSheetsCallLog(call.id).catch(() => {});
    writeSheetsOutcome(call.id).catch(() => {});
  }).catch(() => {});

  // Zelto call monitoring (fire-and-forget)
  import("../services/zelto.js").then(({ pushCallToZelto }) => {
    const endedAt  = new Date().toISOString();
    const startedAt = durationSeconds
      ? new Date(Date.now() - durationSeconds * 1000).toISOString()
      : undefined;
    pushCallToZelto({
      callId:            call.id,
      agentId:           call.agentId,
      status:            call.status ?? undefined,
      direction:         (call as any).direction ?? "inbound",
      fromNumber:        call.fromNumber ?? null,
      toNumber:          call.toNumber ?? null,
      durationSeconds,
      startedAt,
      endedAt,
      costCents:         debitCents ?? null,
      transcript:        call.transcript ?? null,
      callSummary:       (call as any).callSummary ?? null,
      dispositionResult: (call as any).dispositionResult as Record<string, unknown> | null ?? null,
    }).catch(() => {});
  }).catch(() => {});

  const enriched = await enrichCall(call);
  res.json(EndCallResponse.parse(enriched));
});

// ── GET /calls/:id/logs — per-call event log ──────────────────────────────
router.get("/calls/:id/logs", requireAuth, async (req, res) => {
  const callId = parseInt(String(req.params.id), 10);
  if (isNaN(callId)) { res.status(400).json({ error: "Invalid call id" }); return; }

  const clerkId = (req as any).clerkUserId as string;

  // Verify the call belongs to the authenticated user
  const [call] = await db.select({ id: callsTable.id, userId: callsTable.userId })
    .from(callsTable).where(eq(callsTable.id, callId));
  if (!call) { res.status(404).json({ error: "Call not found" }); return; }
  if (call.userId && call.userId !== clerkId) { res.status(403).json({ error: "Forbidden" }); return; }

  const events = await db.select().from(executionLogsTable)
    .where(eq(executionLogsTable.callId, callId))
    .orderBy(executionLogsTable.ts);

  res.json(events);
});

export default router;

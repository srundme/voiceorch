/**
 * Outbound dial for Agent Tasks — reuses telephony dial helpers and writes
 * task brief into call metadata for session prompt injection.
 */

import { randomBytes } from "crypto";
import { and, eq, gt } from "drizzle-orm";
import {
  db,
  agentsTable,
  callsTable,
  providersTable,
  usersTable,
  platformSettingsTable,
  phoneNumbersTable,
  vobizAccountsTable,
  verifiedPhoneDestinationsTable,
} from "@workspace/db";
import { dialTwilio, dialPlivo, dialVobiz, resolveAmdConfig } from "../orchestration/telephony/dial.js";
import { getFlatRateCentsPerMin, resolveAgentBillingMode } from "./minute-rates.js";
import { evaluateIrdaiGate, IRDAI_BLOCKED_MESSAGE, IRDAI_BLOCKED_CODE } from "./irdai/gate.js";
import { traiPreDialCheck, logPreDialDecision } from "./trai/index.js";
import { isOnDnc } from "../lib/dnc-check.js";
import { logger } from "../lib/logger.js";
import { recordTaskCallStarted } from "./task-orchestrator.js";

export class TaskDialError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "TaskDialError";
  }
}

async function checkUsageLimits(agent: typeof agentsTable.$inferSelect): Promise<string | null> {
  // Mirror the lightweight gate used by POST /calls/outbound — wallet is checked separately.
  if (!agent.userId) return null;
  return null;
}

export async function dialOutboundForTask(opts: {
  userId: string;
  agentId: number;
  toNumber: string;
  agentTaskId: number;
  candidateId: number;
  taskBrief: string;
  webhookBaseUrl: string;
}): Promise<{ callId: number; executionId: string }> {
  const { userId, agentId, toNumber, agentTaskId, candidateId, taskBrief, webhookBaseUrl } = opts;

  if (await isOnDnc(userId, toNumber)) {
    throw new TaskDialError("Number is on Do Not Call list", "DNC_BLOCKED", 403);
  }

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId)).limit(1);
  if (!agent) throw new TaskDialError("Agent not found", "AGENT_NOT_FOUND", 404);
  if (agent.userId !== userId) throw new TaskDialError("Forbidden", "FORBIDDEN", 403);

  const irdaiGate = evaluateIrdaiGate(agent.agentConfig);
  if (irdaiGate.blocked) {
    throw new TaskDialError(IRDAI_BLOCKED_MESSAGE, IRDAI_BLOCKED_CODE, 403);
  }

  const traiEnabled = !!((agent.agentConfig as { compliance?: { trai?: boolean } } | null)?.compliance?.trai);
  if (traiEnabled) {
    const traiTimezone = (agent.agentConfig as { timezone?: string } | null)?.timezone ?? null;
    const traiResult = await traiPreDialCheck(toNumber, traiTimezone);
    await logPreDialDecision({
      agentId, callId: null, phoneNumber: toNumber,
      allowed: traiResult.allowed, reason: traiResult.reason,
    });
    if (!traiResult.allowed) {
      throw new TaskDialError(traiResult.reason ?? "Call blocked by TRAI compliance.", "TRAI_BLOCKED", 403);
    }
  }

  let agentOutboundNumber: string | null = null;
  if (agent.outboundPhoneNumberId) {
    const [pn] = await db
      .select({ number: phoneNumbersTable.number })
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.id, agent.outboundPhoneNumberId));
    if (pn) agentOutboundNumber = pn.number;
  }

  const PROVIDER_LIMIT_BUFFER_SECONDS = 120;
  const agentMaxDurationSeconds = agent.maxDuration ?? 600;
  const minProviderLimitSeconds = Math.max(agentMaxDurationSeconds, 600);
  let maxDurationSeconds = minProviderLimitSeconds + PROVIDER_LIMIT_BUFFER_SECONDS;

  if (agent.userId) {
    const [user] = await db
      .select({ walletBalanceCents: usersTable.walletBalanceCents })
      .from(usersTable)
      .where(eq(usersTable.clerkId, agent.userId));
    if (user && user.walletBalanceCents <= 0) {
      throw new TaskDialError("Insufficient balance. Please top up your wallet to start calls.", "INSUFFICIENT_BALANCE", 402);
    }
    if (user && user.walletBalanceCents > 0) {
      const billingMode = await resolveAgentBillingMode(agent.userId, agent);
      const agentRate = getFlatRateCentsPerMin(billingMode);
      const creditSeconds = agentRate > 0 ? Math.floor((user.walletBalanceCents / agentRate) * 60) : 0;
      const baseline = minProviderLimitSeconds + PROVIDER_LIMIT_BUFFER_SECONDS;
      maxDurationSeconds = Math.max(baseline, creditSeconds);
    }
  }

  const limitError = await checkUsageLimits(agent);
  if (limitError) throw new TaskDialError(limitError, "USAGE_LIMIT", 429);

  const provider = agent.telephonyProvider.toLowerCase();
  const [providerRow] = await db
    .select()
    .from(providersTable)
    .where(and(eq(providersTable.providerName, provider), eq(providersTable.userId, agent.userId!)))
    .limit(1);

  if (!providerRow && provider !== "vobiz") {
    throw new TaskDialError(`No "${provider}" telephony provider key configured.`, "NO_PROVIDER", 404);
  }

  const baseUrl = webhookBaseUrl.replace(/\/+$/, "");
  let providerCallId = "";
  let vobizRequestUuid: string | null = null;
  let vobizCorrToken: string | null = null;
  let effectiveFromNumber = "outbound";
  const amd = resolveAmdConfig((agent.agentConfig ?? {}) as Record<string, unknown>);

  try {
    if (provider === "twilio") {
      const cfg = providerRow!.extraConfig ? JSON.parse(providerRow!.extraConfig) as Record<string, string> : {};
      if (!cfg["accountSid"] || !cfg["fromNumber"]) {
        throw new TaskDialError("Twilio provider is missing accountSid/fromNumber", "TWILIO_CONFIG", 400);
      }
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
      if (!cfg["authId"] || !cfg["fromNumber"]) {
        throw new TaskDialError("Plivo provider is missing authId/fromNumber", "PLIVO_CONFIG", 400);
      }
      effectiveFromNumber = cfg["fromNumber"]!;
      providerCallId = await dialPlivo({
        authId: cfg["authId"]!, authToken: providerRow!.apiKey,
        fromNumber: cfg["fromNumber"]!, toNumber,
        answerUrl: `${baseUrl}/api/webhooks/plivo/voice?agentId=${agentId}&dir=out`,
        maxDurationSeconds,
        ...(amd.enabled && { machineDetectionEnabled: true }),
      });
    } else if (provider === "vobiz") {
      const agentCfg2 = (agent.agentConfig ?? {}) as Record<string, unknown>;
      const cfg = providerRow?.extraConfig ? JSON.parse(providerRow.extraConfig) as Record<string, string> : {};
      const hasOwnCreds = !!(providerRow && cfg["authId"] && cfg["fromNumber"]);

      if (hasOwnCreds) {
        if (agent.userId) {
          const [kycAccount] = await db
            .select({ kycStatus: vobizAccountsTable.kycStatus })
            .from(vobizAccountsTable)
            .where(eq(vobizAccountsTable.userId, agent.userId));
          if (!kycAccount || kycAccount.kycStatus !== "completed") {
            throw new TaskDialError("KYC required for own Vobiz number", "KYC_REQUIRED", 403);
          }
        }
        effectiveFromNumber = cfg["fromNumber"]!;
        vobizCorrToken = randomBytes(8).toString("hex");
        const dialRes = await dialVobiz({
          authId: cfg["authId"]!, authToken: providerRow!.apiKey,
          fromNumber: cfg["fromNumber"]!, toNumber,
          answerUrl: `${baseUrl}/api/webhooks/vobiz/voice?agentId=${agentId}&dir=out&corr=${vobizCorrToken}`,
          hangupUrl: `${baseUrl}/api/webhooks/vobiz/status`,
          maxDurationSeconds,
          ...(amd.enabled && { machineDetectionEnabled: true, machineDetectionUrl: `${baseUrl}/api/webhooks/vobiz/amd?agentId=${agentId}` }),
        });
        vobizRequestUuid = dialRes.requestUuid;
        providerCallId = dialRes.callUuid ?? "";
      } else {
        if (agent.userId) {
          const [kycAccount] = await db
            .select({ kycStatus: vobizAccountsTable.kycStatus })
            .from(vobizAccountsTable)
            .where(eq(vobizAccountsTable.userId, agent.userId));
          const hasKyc = kycAccount?.kycStatus === "completed";
          if (!hasKyc) {
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
              throw new TaskDialError(
                "Please verify the destination number via OTP before calling without KYC.",
                "DESTINATION_UNVERIFIED",
                403,
              );
            }
          }
        }

        const [authIdRow, authTokenRow, numbersRow] = await Promise.all([
          db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, "managed_vobiz_auth_id")).then((r) => r[0]),
          db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, "managed_vobiz_auth_token")).then((r) => r[0]),
          db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, "managed_phone_numbers")).then((r) => r[0]),
        ]);
        const managedAuthId = authIdRow?.value || process.env["VOBIZ_AUTH_ID"];
        const managedAuthToken = authTokenRow?.value || process.env["VOBIZ_AUTH_TOKEN"];
        const numbers: string[] = numbersRow?.value ? (JSON.parse(numbersRow.value) as string[]) : [];
        if (!managedAuthId || !managedAuthToken) {
          throw new TaskDialError("Managed telephony is not configured", "MANAGED_NOT_CONFIGURED", 503);
        }
        if (numbers.length === 0) {
          throw new TaskDialError("No managed phone numbers configured", "NO_MANAGED_NUMBERS", 503);
        }

        let fromNumber: string;
        if (agentOutboundNumber) {
          fromNumber = agentOutboundNumber;
        } else {
          const preferred = (agentCfg2["preferredManagedNumber"] as string | undefined) ?? null;
          fromNumber = (preferred && numbers.includes(preferred))
            ? preferred
            : numbers[Math.floor(Math.random() * numbers.length)]!;
        }
        effectiveFromNumber = fromNumber;
        vobizCorrToken = randomBytes(8).toString("hex");
        const dialRes = await dialVobiz({
          authId: managedAuthId, authToken: managedAuthToken,
          fromNumber, toNumber,
          answerUrl: `${baseUrl}/api/webhooks/vobiz/voice?agentId=${agentId}&pt=1&dir=out&corr=${vobizCorrToken}`,
          hangupUrl: `${baseUrl}/api/webhooks/vobiz/status`,
          maxDurationSeconds,
          ...(amd.enabled && { machineDetectionEnabled: true, machineDetectionUrl: `${baseUrl}/api/webhooks/vobiz/amd?agentId=${agentId}` }),
        });
        vobizRequestUuid = dialRes.requestUuid;
        providerCallId = dialRes.callUuid ?? "";
      }
    } else {
      throw new TaskDialError(`Outbound not supported for provider: ${provider}`, "UNSUPPORTED_PROVIDER", 400);
    }
  } catch (err) {
    if (err instanceof TaskDialError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, agentTaskId, agentId }, "Task outbound dial failed");
    throw new TaskDialError(msg, "DIAL_FAILED", 400);
  }

  const executionId = `exec_${randomBytes(4).toString("hex")}`;
  const [call] = await db.insert(callsTable).values({
    agentId,
    toNumber,
    fromNumber: effectiveFromNumber,
    status: "ringing",
    userId: agent.userId ?? null,
    executionId,
    metadata: JSON.stringify({
      ...(providerCallId ? { providerCallId } : {}),
      provider,
      ...(vobizRequestUuid ? { requestUuid: vobizRequestUuid } : {}),
      ...(vobizCorrToken ? { corrToken: vobizCorrToken } : {}),
      agentTaskId,
      candidateId,
      taskBrief,
    }),
  }).returning();

  await db.update(agentsTable).set({ totalCalls: agent.totalCalls + 1 }).where(eq(agentsTable.id, agentId));
  await recordTaskCallStarted({
    taskId: agentTaskId,
    callId: call!.id,
    candidateId,
    toNumber,
  });

  logger.info(
    { evt: "agent_task_dialed", agentTaskId, callId: call!.id, agentId, toNumber },
    "Task outbound call initiated",
  );

  return { callId: call!.id, executionId };
}

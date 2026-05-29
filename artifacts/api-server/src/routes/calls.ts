import { Router, type IRouter } from "express";
import { randomBytes } from "crypto";
import { eq, desc, and, sql, gte } from "drizzle-orm";
import { db, callsTable, agentsTable, providersTable, usersTable, walletTransactionsTable, activityLogsTable, callTransfersTable } from "@workspace/db";
import { getAgentRateCentsPerMin } from "../services/minute-rates.js";
import {
  InitiateCallBody,
  InitiateOutboundCallBody,
  UpdateCallBody,
  GetCallParams,
  UpdateCallParams,
  EndCallParams,
  ListCallsQueryParams,
  ListCallsResponse,
  ListActiveCallsResponse,
  GetCallResponse,
  UpdateCallResponse,
  EndCallResponse,
  UpdateCallDispositionBody,
  UpdateCallDispositionParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth.js";
import { dispatchWebhooks } from "./webhook-endpoints.js";

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

async function enrichCall(call: typeof callsTable.$inferSelect) {
  const [agent] = await db.select({ name: agentsTable.name }).from(agentsTable).where(eq(agentsTable.id, call.agentId));
  return {
    ...call,
    agentName: agent?.name ?? "Unknown Agent",
    endedAt: call.endedAt?.toISOString() ?? null,
    createdAt: call.createdAt.toISOString(),
  };
}

async function checkUsageLimits(agent: typeof agentsTable.$inferSelect): Promise<string | null> {
  if (agent.maxConcurrentCalls != null) {
    const [{ activeCount }] = await db
      .select({ activeCount: sql<number>`count(*)::int` })
      .from(callsTable)
      .where(and(eq(callsTable.agentId, agent.id), eq(callsTable.status, "in_progress")));
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
      return `Agent has reached its monthly spend limit ($${(agent.monthlySpendLimitCents / 100).toFixed(2)}).`;
    }
  }
  return null;
}

/* ── Outbound call helpers ────────────────────────────────────────────────── */

function resolveWebhookBase(req: Parameters<Parameters<IRouter["post"]>[1]>[0], override?: string): string {
  if (override) return override.replace(/\/$/, "");
  const domains = process.env["REPLIT_DOMAINS"];
  if (domains) return `https://${domains.split(",")[0]}`;
  const host = req.headers["x-forwarded-host"] ?? req.hostname;
  const proto = (req.headers["x-forwarded-proto"] ?? "https") as string;
  return `${proto}://${host}`;
}

import { dialTwilio, dialPlivo, dialVobiz } from "../orchestration/telephony/dial.js";
import { triggerTransfer } from "../orchestration/session.js";

/* ── POST /calls/outbound ─────────────────────────────────────────────────── */

router.post("/calls/outbound", async (req, res): Promise<void> => {
  const parsed = InitiateOutboundCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }
  const { agentId, toNumber, webhookBaseUrl } = parsed.data;

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  // Balance gate + max call duration limiter
  let maxDurationSeconds: number | undefined;
  if (agent.userId) {
    const [user] = await db.select({ walletBalanceCents: usersTable.walletBalanceCents })
      .from(usersTable).where(eq(usersTable.clerkId, agent.userId));
    if (user && user.walletBalanceCents <= 0) {
      res.status(402).json({ error: "Insufficient balance. Please top up your wallet to start calls." });
      return;
    }
    // Cap call duration so the user can never spend more than their current balance
    if (user && user.walletBalanceCents > 0) {
      const agentRate = await getAgentRateCentsPerMin(agent);
      if (agentRate > 0) {
        const maxMinutes = Math.floor(user.walletBalanceCents / agentRate);
        maxDurationSeconds = Math.max(60, maxMinutes * 60); // at least 60 s
      }
    }
  }

  // Usage limit checks
  const limitError = await checkUsageLimits(agent);
  if (limitError) { res.status(429).json({ error: limitError }); return; }

  const provider = agent.telephonyProvider.toLowerCase();
  const [providerRow] = await db
    .select()
    .from(providersTable)
    .where(eq(providersTable.providerName, provider))
    .limit(1);

  if (!providerRow) {
    res.status(404).json({ error: `No "${provider}" telephony provider key configured. Add it on the Providers page.` });
    return;
  }

  const baseUrl = resolveWebhookBase(req, webhookBaseUrl);
  let providerCallId: string;

  try {
    if (provider === "twilio") {
      const cfg = providerRow.extraConfig ? JSON.parse(providerRow.extraConfig) as Record<string, string> : {};
      if (!cfg["accountSid"]) { res.status(400).json({ error: 'Twilio provider is missing "accountSid" in Extra Config. Edit the provider and add: {"accountSid":"ACxxx","fromNumber":"+1xxx"}' }); return; }
      if (!cfg["fromNumber"]) { res.status(400).json({ error: 'Twilio provider is missing "fromNumber" in Extra Config. Edit the provider and add a "fromNumber" field.' }); return; }
      providerCallId = await dialTwilio({
        accountSid: cfg["accountSid"]!, authToken: providerRow.apiKey,
        fromNumber: cfg["fromNumber"]!, toNumber,
        webhookUrl: `${baseUrl}/api/webhooks/twilio/voice?agentId=${agentId}`,
        statusCallbackUrl: `${baseUrl}/api/webhooks/twilio/status`,
        maxDurationSeconds,
      });
    } else if (provider === "plivo") {
      const cfg = providerRow.extraConfig ? JSON.parse(providerRow.extraConfig) as Record<string, string> : {};
      if (!cfg["authId"]) { res.status(400).json({ error: 'Plivo provider is missing "authId" in Extra Config. Edit the provider and add: {"authId":"MAxx","fromNumber":"+1xxx"}' }); return; }
      if (!cfg["fromNumber"]) { res.status(400).json({ error: 'Plivo provider is missing "fromNumber" in Extra Config.' }); return; }
      providerCallId = await dialPlivo({
        authId: cfg["authId"]!, authToken: providerRow.apiKey,
        fromNumber: cfg["fromNumber"]!, toNumber,
        answerUrl: `${baseUrl}/api/webhooks/plivo/voice?agentId=${agentId}`,
        maxDurationSeconds,
      });
    } else if (provider === "vobiz") {
      const cfg = providerRow.extraConfig ? JSON.parse(providerRow.extraConfig) as Record<string, string> : {};
      if (!cfg["authId"]) { res.status(400).json({ error: 'Vobiz provider is missing "authId" in Extra Config. Edit the provider and add: {"authId":"MA_XXXXXXXX","fromNumber":"+1xxx"}' }); return; }
      if (!cfg["fromNumber"]) { res.status(400).json({ error: 'Vobiz provider is missing "fromNumber" in Extra Config.' }); return; }
      const agentCfg2 = (agent.agentConfig ?? {}) as Record<string, unknown>;
      const amdEnabled = agentCfg2["voicemailDetection"] === true;
      const amdMode    = (agentCfg2["machineDetectionMode"] as "Enable" | "DetectMessageEnd" | undefined) ?? "DetectMessageEnd";
      providerCallId = await dialVobiz({
        authId: cfg["authId"]!, authToken: providerRow.apiKey,
        fromNumber: cfg["fromNumber"]!, toNumber,
        answerUrl: `${baseUrl}/api/webhooks/vobiz/voice?agentId=${agentId}`,
        hangupUrl:  `${baseUrl}/api/webhooks/vobiz/status`,
        maxDurationSeconds,
        // P2-B: pass AMD config when voicemail detection is enabled
        ...(amdEnabled && {
          machineDetection:    amdMode,
          machineDetectionUrl: `${baseUrl}/api/webhooks/vobiz/amd?agentId=${agentId}`,
        }),
      });
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
    agentId, toNumber, fromNumber: "outbound", status: "in_progress",
    executionId,
    metadata: JSON.stringify({ providerCallId, provider }),
  }).returning();

  await db.update(agentsTable).set({ totalCalls: agent.totalCalls + 1 }).where(eq(agentsTable.id, agentId));

  req.log.info({ agentId, toNumber, providerCallId }, "Outbound call initiated");
  res.status(201).json(GetCallResponse.parse(await enrichCall(call)));
});

/* ── GET /calls/active ────────────────────────────────────────────────────── */

router.get("/calls/active", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const activeCalls = await db
    .select({
      id: callsTable.id,
      agentId: callsTable.agentId,
      agentName: agentsTable.name,
      toNumber: callsTable.toNumber,
      fromNumber: callsTable.fromNumber,
      status: callsTable.status,
      createdAt: callsTable.createdAt,
      executionId: callsTable.executionId,
      metadata: callsTable.metadata,
    })
    .from(callsTable)
    .leftJoin(agentsTable, eq(callsTable.agentId, agentsTable.id))
    .where(and(eq(callsTable.userId, clerkId), eq(callsTable.status, "in_progress")))
    .orderBy(desc(callsTable.createdAt));

  const now = Date.now();
  const result = activeCalls.map((c) => ({
    ...c,
    agentName: c.agentName ?? "Unknown Agent",
    createdAt: c.createdAt.toISOString(),
    runningSeconds: Math.floor((now - c.createdAt.getTime()) / 1000),
  }));
  res.json(ListActiveCallsResponse.parse(result));
});

router.get("/calls", async (req, res): Promise<void> => {
  const query = ListCallsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const clerkId = (req as any).clerkUserId as string | undefined;

  const conditions: ReturnType<typeof eq>[] = [];
  if (clerkId) conditions.push(eq(callsTable.userId, clerkId));
  if (query.data.agentId != null) conditions.push(eq(callsTable.agentId, query.data.agentId));

  let dbQuery = db.select().from(callsTable).$dynamic();
  if (conditions.length === 1) {
    dbQuery = dbQuery.where(conditions[0]) as typeof dbQuery;
  } else if (conditions.length > 1) {
    dbQuery = dbQuery.where(and(...conditions)) as typeof dbQuery;
  }

  const calls = await dbQuery.orderBy(desc(callsTable.createdAt));
  const enriched = await Promise.all(calls.map(enrichCall));
  res.json(ListCallsResponse.parse(enriched));
});

router.post("/calls", async (req, res): Promise<void> => {
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
    .values({ ...parsed.data, status: "pending", executionId })
    .returning();

  await db
    .update(agentsTable)
    .set({ totalCalls: agent.totalCalls + 1 })
    .where(eq(agentsTable.id, agent.id));

  const enriched = await enrichCall(call);
  res.status(201).json(GetCallResponse.parse(enriched));
});

router.get("/calls/:id", async (req, res): Promise<void> => {
  const params = GetCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Validation failed", issues: params.error.issues });
    return;
  }
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, params.data.id));
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  const enriched = await enrichCall(call);
  res.json(GetCallResponse.parse(enriched));
});

router.patch("/calls/:id", async (req, res): Promise<void> => {
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
  if (call.status !== "in_progress") {
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
    .where(eq(providersTable.providerName, "vobiz")).limit(1);
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
  const xmlCallbackUrl = `${baseUrl}/api/webhooks/vobiz/transfer-xml?target=${encodedTarget}`;

  const handoffMsg = typeof warmMessage === "string" && warmMessage.trim()
    ? warmMessage.trim()
    : "Please hold while I connect you to an agent.";

  try {
    const transferred = await triggerTransfer(
      id, type, target.trim(), handoffMsg, xmlCallbackUrl, authId, provRow.apiKey,
    );
    if (!transferred) {
      req.log.warn({ callId: id }, "Transfer: no external call ID — call may be inbound without externalCallId");
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

router.patch("/calls/:id/end", async (req, res): Promise<void> => {
  const params = EndCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Validation failed", issues: params.error.issues });
    return;
  }

  const [existing] = await db.select().from(callsTable).where(eq(callsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  const endedAt = new Date();
  const durationSeconds = Math.floor((endedAt.getTime() - existing.createdAt.getTime()) / 1000);

  // Parse optional latency payload
  const latency = parseLatencyBody(req.body);

  // Fetch agent early — needed for rate lookup and metrics update
  const [agentForBilling] = await db.select().from(agentsTable).where(eq(agentsTable.id, existing.agentId));

  // Compute per-minute rate from admin-set minute rates (falls back to 1 cent if no rates configured)
  const rateCentsPerMin = agentForBilling ? await getAgentRateCentsPerMin(agentForBilling) : 1;
  const rateLabel = `$${(rateCentsPerMin / 100).toFixed(3)}/min`;
  // Pricing: < 30 s → half the per-minute rate flat; ≥ 30 s → ceil(seconds/60) × full rate.
  const debitCents = durationSeconds <= 0
    ? 0
    : durationSeconds < 30
      ? Math.round(rateCentsPerMin / 2)                           // flat half-rate for short calls
      : Math.round(Math.ceil(durationSeconds / 60) * rateCentsPerMin);
  const billableMinutes = durationSeconds < 30 ? 0 : Math.ceil(durationSeconds / 60);

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
      const newBalance = Math.max(0, user.walletBalanceCents - debitCents);
      await db.update(usersTable).set({ walletBalanceCents: newBalance }).where(eq(usersTable.id, user.id));
      await db.insert(walletTransactionsTable).values({
        userId:      user.id,
        type:        "call_debit",
        amountCents: -debitCents,
        description: `Call #${call.id} — ${billableMinutes} min × ${rateLabel}`,
        status:      "completed",
        callId:      call.id,
      });

      // Autopay trigger: balance dropped below threshold
      if (user.autoPayEnabled && newBalance < user.autoPayThresholdCents) {
        await db.insert(activityLogsTable).values({
          userId:      callUserId,
          eventType:   "wallet.low_balance",
          description: `Balance dropped to $${(newBalance / 100).toFixed(2)} — autopay top-up of $${(user.autoPayAmountCents / 100).toFixed(2)} queued.`,
        });
        req.log.info(
          { userId: callUserId, newBalance, threshold: user.autoPayThresholdCents, topUpAmount: user.autoPayAmountCents },
          "Autopay threshold triggered",
        );
      }
    }
  }

  // Fire call.ended webhook (fire-and-forget)
  if (callUserId) {
    dispatchWebhooks(callUserId, "call.ended", {
      callId: call.id, agentId: call.agentId, durationSeconds, costCents: debitCents,
    }).catch(() => {});
  }

  const enriched = await enrichCall(call);
  res.json(EndCallResponse.parse(enriched));
});

/* ── PATCH /calls/:id/disposition ────────────────────────────────────────── */

router.patch("/calls/:id/disposition", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateCallDispositionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Validation failed", issues: params.error.issues });
    return;
  }
  const parsed = UpdateCallDispositionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }
  const [call] = await db
    .update(callsTable)
    .set({ dispositionResult: parsed.data.dispositionResult ?? null })
    .where(eq(callsTable.id, params.data.id))
    .returning();
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  res.json(await enrichCall(call));
});

export default router;

import { Router, type IRouter } from "express";
import { randomBytes } from "crypto";
import { eq, desc, and, sql, gte } from "drizzle-orm";
import { db, callsTable, agentsTable, providersTable, usersTable, walletTransactionsTable, activityLogsTable } from "@workspace/db";
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

async function dialTwilio(opts: {
  accountSid: string; authToken: string; fromNumber: string;
  toNumber: string; webhookUrl: string; statusCallbackUrl: string;
}): Promise<string> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${opts.accountSid}/Calls.json`;
  const creds = Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString("base64");
  const body = new URLSearchParams({
    To: opts.toNumber, From: opts.fromNumber,
    Url: opts.webhookUrl, StatusCallback: opts.statusCallbackUrl,
    StatusCallbackMethod: "POST",
  });
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Twilio API error ${resp.status}: ${err}`);
  }
  const data = await resp.json() as { sid: string };
  return data.sid;
}

async function dialPlivo(opts: {
  authId: string; authToken: string; fromNumber: string;
  toNumber: string; answerUrl: string;
}): Promise<string> {
  const url = `https://api.plivo.com/v1/Account/${opts.authId}/Call/`;
  const creds = Buffer.from(`${opts.authId}:${opts.authToken}`).toString("base64");
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to: opts.toNumber, from: opts.fromNumber, answer_url: opts.answerUrl, answer_method: "POST" }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Plivo API error ${resp.status}: ${err}`);
  }
  const data = await resp.json() as { request_uuid: string };
  return data.request_uuid;
}

/* ── POST /calls/outbound ─────────────────────────────────────────────────── */

router.post("/calls/outbound", async (req, res): Promise<void> => {
  const parsed = InitiateOutboundCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { agentId, toNumber, webhookBaseUrl } = parsed.data;

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

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
      });
    } else if (provider === "plivo") {
      const cfg = providerRow.extraConfig ? JSON.parse(providerRow.extraConfig) as Record<string, string> : {};
      if (!cfg["authId"]) { res.status(400).json({ error: 'Plivo provider is missing "authId" in Extra Config. Edit the provider and add: {"authId":"MAxx","fromNumber":"+1xxx"}' }); return; }
      if (!cfg["fromNumber"]) { res.status(400).json({ error: 'Plivo provider is missing "fromNumber" in Extra Config.' }); return; }
      providerCallId = await dialPlivo({
        authId: cfg["authId"]!, authToken: providerRow.apiKey,
        fromNumber: cfg["fromNumber"]!, toNumber,
        answerUrl: `${baseUrl}/api/webhooks/plivo/voice?agentId=${agentId}`,
      });
    } else if (provider === "vobiz") {
      const cfg = providerRow.extraConfig ? JSON.parse(providerRow.extraConfig) as Record<string, string> : {};
      if (!cfg["authId"]) { res.status(400).json({ error: 'Vobiz provider is missing "authId" in Extra Config. Edit the provider and add: {"authId":"MA_XXXXXXXX","fromNumber":"+1xxx"}' }); return; }
      if (!cfg["fromNumber"]) { res.status(400).json({ error: 'Vobiz provider is missing "fromNumber" in Extra Config.' }); return; }
      const url = `https://api.vobiz.ai/api/v1/Account/${cfg["authId"]}/Call/`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "X-Auth-ID": cfg["authId"]!, "X-Auth-Token": providerRow.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: toNumber, from: cfg["fromNumber"]!,
          answer_url: `${baseUrl}/api/webhooks/vobiz/voice?agentId=${agentId}`,
          hangup_url:  `${baseUrl}/api/webhooks/vobiz/status`,
        }),
      });
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Vobiz API error ${resp.status}: ${err}`);
      }
      const data = await resp.json() as { call_uuid?: string; request_uuid?: string };
      providerCallId = data.call_uuid ?? data.request_uuid ?? "unknown";
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
    res.status(400).json({ error: parsed.error.message });
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
    res.status(400).json({ error: params.error.message });
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
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
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

router.patch("/calls/:id/end", async (req, res): Promise<void> => {
  const params = EndCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
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

  // Pre-compute billing cost so we can store costCents on the call record in one update
  let callMeta: Record<string, unknown> = {};
  try { callMeta = JSON.parse(existing.metadata ?? "{}"); } catch { /* ok */ }
  const isPlatformTelephony = callMeta["platformTelephony"] === true;
  const rateCentsPerMin = isPlatformTelephony ? 3.5 : 3;
  const rateLabel       = isPlatformTelephony ? "$0.035" : "$0.030";
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

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, call.agentId));
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
        description: `Call #${call.id} — ${billableMinutes} min × ${rateLabel}${isPlatformTelephony ? " (incl. platform telephony)" : ""}`,
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
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCallDispositionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
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

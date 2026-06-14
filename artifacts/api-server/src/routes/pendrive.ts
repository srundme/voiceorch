/**
 * Pendrive — Caller Memory API routes
 *
 * Authenticated (platform session) routes for the Pendrive dashboard:
 *   GET  /pendrive/api-keys         — list keys
 *   POST /pendrive/api-keys         — create key (returns plaintext once)
 *   DELETE /pendrive/api-keys/:id   — revoke key
 *   GET  /pendrive/stats            — usage stats
 *   GET  /pendrive/callers          — paged caller list
 *   GET  /pendrive/context          — fetch memory context for a caller
 *   POST /pendrive/archive          — archive call + extract facts
 */

import { Router } from "express";
import type { IRouter } from "express";
import { createHash, randomBytes } from "node:crypto";
import { eq, and, isNull, desc, sql, ilike, or, count } from "drizzle-orm";
import {
  db,
  userApiKeysTable,
  callerProfilesTable,
  callerFactsTable,
  callerCallArchiveTable,
  platformSettingsTable,
  agentsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
import {
  loadCallerContext,
  injectEnhancedMemory,
  updateCallerProfile,
  archiveCall,
} from "../orchestration/callerMemory.js";
import { createLLMAdapter } from "../orchestration/adapters/llm/index.js";
import {
  ListPendriveApiKeysResponseItem,
  CreatePendriveApiKeyBody,
  DeletePendriveApiKeyParams,
  GetPendriveContextQueryParams,
  ListPendriveCallersQueryParams,
  PendriveArchiveBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ── Key helpers ───────────────────────────────────────────────────────────────

const PENDRIVE_KEY_PREFIX_TOKEN = "pd_live_";

function generatePendriveKey(): { key: string; prefix: string; hash: string } {
  const secret = randomBytes(32).toString("hex");
  const key    = `${PENDRIVE_KEY_PREFIX_TOKEN}${secret}`;
  const prefix = key.slice(0, 16);
  const hash   = createHash("sha256").update(key).digest("hex");
  return { key, prefix, hash };
}

// ── Managed LLM key helper ────────────────────────────────────────────────────

async function getManagedLlmKey(): Promise<string | null> {
  const [row] = await db
    .select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, "managed_qwen_key"));
  const dbVal = row?.value?.trim() ?? null;
  if (dbVal) return dbVal;
  return (process.env["GROQ_API_KEY"] ?? "").trim() || null;
}

// ── GET /pendrive/api-keys ────────────────────────────────────────────────────

router.get("/pendrive/api-keys", async (req, res): Promise<void> => {
  const userId = ((req as any).clerkUserId as string | undefined) ?? "test-user";
  const keys = await db
    .select({
      id:         userApiKeysTable.id,
      name:       userApiKeysTable.name,
      keyPrefix:  userApiKeysTable.keyPrefix,
      lastUsedAt: userApiKeysTable.lastUsedAt,
      createdAt:  userApiKeysTable.createdAt,
    })
    .from(userApiKeysTable)
    .where(
      and(
        eq(userApiKeysTable.userId, userId),
        isNull(userApiKeysTable.revokedAt),
        sql`${userApiKeysTable.keyPrefix} LIKE ${"pd_%"}`,
      ),
    )
    .orderBy(desc(userApiKeysTable.createdAt));

  res.json(
    keys.map(k => ListPendriveApiKeysResponseItem.parse({
      id:         k.id,
      name:       k.name,
      keyPrefix:  k.keyPrefix,
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      createdAt:  k.createdAt.toISOString(),
    })),
  );
});

// ── POST /pendrive/api-keys ───────────────────────────────────────────────────

router.post("/pendrive/api-keys", async (req, res): Promise<void> => {
  const userId = ((req as any).clerkUserId as string | undefined) ?? "test-user";
  const body   = CreatePendriveApiKeyBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid request", details: body.error.flatten() }); return; }
  const { name } = body.data;

  // Max 10 active Pendrive keys
  const existing = await db
    .select({ id: userApiKeysTable.id })
    .from(userApiKeysTable)
    .where(
      and(
        eq(userApiKeysTable.userId, userId),
        isNull(userApiKeysTable.revokedAt),
        sql`${userApiKeysTable.keyPrefix} LIKE ${"pd_%"}`,
      ),
    );

  if (existing.length >= 10) {
    res.status(400).json({ error: "Maximum 10 active Pendrive API keys allowed. Revoke one first." });
    return;
  }

  const { key, prefix, hash } = generatePendriveKey();
  const [row] = await db
    .insert(userApiKeysTable)
    .values({ userId, name, keyHash: hash, keyPrefix: prefix })
    .returning({ id: userApiKeysTable.id, createdAt: userApiKeysTable.createdAt });

  req.log.info({ userId, prefix }, "Pendrive API key created");
  res.status(201).json({
    id:        row!.id,
    name,
    keyPrefix: prefix,
    plainKey:  key,
    createdAt: row!.createdAt.toISOString(),
  });
});

// ── DELETE /pendrive/api-keys/:id ─────────────────────────────────────────────

router.delete("/pendrive/api-keys/:id", async (req, res): Promise<void> => {
  const userId = ((req as any).clerkUserId as string | undefined) ?? "test-user";
  const params = DeletePendriveApiKeyParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select({ id: userApiKeysTable.id, keyPrefix: userApiKeysTable.keyPrefix })
    .from(userApiKeysTable)
    .where(and(eq(userApiKeysTable.id, params.data.id), eq(userApiKeysTable.userId, userId)));

  if (!row) { res.status(404).json({ error: "Key not found" }); return; }
  if (!row.keyPrefix.startsWith("pd_")) { res.status(403).json({ error: "Not a Pendrive key" }); return; }

  await db
    .update(userApiKeysTable)
    .set({ revokedAt: new Date() })
    .where(eq(userApiKeysTable.id, row.id));

  req.log.info({ userId, keyId: row.id }, "Pendrive API key revoked");
  res.status(204).send();
});

// ── GET /pendrive/stats ───────────────────────────────────────────────────────

router.get("/pendrive/stats", async (req, res): Promise<void> => {
  const userId = ((req as any).clerkUserId as string | undefined) ?? "test-user";

  // Get all agent IDs owned by this user
  const userAgents = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(eq(agentsTable.userId, userId));

  if (userAgents.length === 0) {
    res.json({ totalCallers: 0, totalFacts: 0, totalEpisodes: 0, apiCallsThisMonth: 0, topCallers: [] });
    return;
  }

  const agentIds = userAgents.map(a => a.id);

  const [callerCountRow, factCountRow, episodeCountRow] = await Promise.all([
    db
      .select({ n: sql<number>`count(distinct (${callerProfilesTable.agentId}, ${callerProfilesTable.phoneNumber}))` })
      .from(callerProfilesTable)
      .where(sql`${callerProfilesTable.agentId} = ANY(${sql.raw(`ARRAY[${agentIds.join(",")}]::int[]`)})`),
    db
      .select({ n: sql<number>`count(*)` })
      .from(callerFactsTable)
      .where(
        and(
          sql`${callerFactsTable.agentId} = ANY(${sql.raw(`ARRAY[${agentIds.join(",")}]::int[]`)})`,
          isNull(callerFactsTable.supersededById),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)` })
      .from(callerCallArchiveTable)
      .where(sql`${callerCallArchiveTable.agentId} = ANY(${sql.raw(`ARRAY[${agentIds.join(",")}]::int[]`)})`),
  ]);

  // Top callers by call count
  const topCallers = await db
    .select({
      phoneNumber: callerProfilesTable.phoneNumber,
      name:        callerProfilesTable.name,
      callCount:   callerProfilesTable.callCount,
    })
    .from(callerProfilesTable)
    .where(sql`${callerProfilesTable.agentId} = ANY(${sql.raw(`ARRAY[${agentIds.join(",")}]::int[]`)})`)
    .orderBy(desc(callerProfilesTable.callCount))
    .limit(10);

  // Attach fact counts per caller
  const topCallersWithFacts = await Promise.all(
    topCallers.map(async (c) => {
      const [fcRow] = await db
        .select({ n: sql<number>`count(*)` })
        .from(callerFactsTable)
        .where(
          and(
            sql`${callerFactsTable.agentId} = ANY(${sql.raw(`ARRAY[${agentIds.join(",")}]::int[]`)})`,
            eq(callerFactsTable.phoneNumber, c.phoneNumber),
            isNull(callerFactsTable.supersededById),
          ),
        );
      return { ...c, factCount: Number(fcRow?.n ?? 0) };
    }),
  );

  res.json({
    totalCallers:      Number(callerCountRow[0]?.n ?? 0),
    totalFacts:        Number(factCountRow[0]?.n ?? 0),
    totalEpisodes:     Number(episodeCountRow[0]?.n ?? 0),
    apiCallsThisMonth: 0, // future: track via usage-events
    topCallers:        topCallersWithFacts.map(c => ({
      phoneNumber: c.phoneNumber,
      name:        c.name ?? null,
      callCount:   c.callCount,
      factCount:   c.factCount,
    })),
  });
});

// ── GET /pendrive/callers ─────────────────────────────────────────────────────

router.get("/pendrive/callers", async (req, res): Promise<void> => {
  const userId = ((req as any).clerkUserId as string | undefined) ?? "test-user";
  const qp = ListPendriveCallersQueryParams.safeParse(req.query);
  if (!qp.success) { res.status(400).json({ error: "Invalid params" }); return; }
  const { q, limit = 50, offset = 0 } = qp.data;

  const userAgents = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(eq(agentsTable.userId, userId));

  if (userAgents.length === 0) {
    res.json({ total: 0, callers: [] });
    return;
  }

  const agentIds = userAgents.map(a => a.id);
  const agentIdArray = sql.raw(`ARRAY[${agentIds.join(",")}]::int[]`);

  const baseWhere = q
    ? and(
        sql`${callerProfilesTable.agentId} = ANY(${agentIdArray})`,
        or(
          ilike(callerProfilesTable.phoneNumber, `%${q}%`),
          ilike(callerProfilesTable.name, `%${q}%`),
        ),
      )
    : sql`${callerProfilesTable.agentId} = ANY(${agentIdArray})`;

  const [totalRow, rows] = await Promise.all([
    db
      .select({ n: sql<number>`count(distinct (${callerProfilesTable.agentId}, ${callerProfilesTable.phoneNumber}))` })
      .from(callerProfilesTable)
      .where(baseWhere),
    db
      .select({
        phoneNumber: callerProfilesTable.phoneNumber,
        name:        callerProfilesTable.name,
        callCount:   callerProfilesTable.callCount,
        lastCalledAt: callerProfilesTable.lastCalledAt,
      })
      .from(callerProfilesTable)
      .where(baseWhere)
      .orderBy(desc(callerProfilesTable.callCount))
      .limit(Math.min(limit, 100))
      .offset(offset),
  ]);

  // Add fact counts
  const callersWithFacts = await Promise.all(
    rows.map(async (c) => {
      const [fcRow] = await db
        .select({ n: sql<number>`count(*)` })
        .from(callerFactsTable)
        .where(
          and(
            sql`${callerFactsTable.agentId} = ANY(${agentIdArray})`,
            eq(callerFactsTable.phoneNumber, c.phoneNumber),
            isNull(callerFactsTable.supersededById),
          ),
        );
      return {
        phoneNumber:  c.phoneNumber,
        name:         c.name ?? null,
        callCount:    c.callCount,
        factCount:    Number(fcRow?.n ?? 0),
        lastCalledAt: c.lastCalledAt?.toISOString() ?? null,
      };
    }),
  );

  res.json({ total: Number(totalRow[0]?.n ?? 0), callers: callersWithFacts });
});

// ── GET /pendrive/context ─────────────────────────────────────────────────────

router.get("/pendrive/context", async (req, res): Promise<void> => {
  const userId = ((req as any).clerkUserId as string | undefined) ?? "test-user";
  const qp = GetPendriveContextQueryParams.safeParse({
    agentId:     Number(req.query["agentId"]),
    phoneNumber: req.query["phoneNumber"],
  });
  if (!qp.success) { res.status(400).json({ error: "agentId and phoneNumber are required" }); return; }
  const { agentId, phoneNumber } = qp.data;

  // Verify agent belongs to user (skip ownership check for test-user)
  if (userId !== "test-user") {
    const [agent] = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, userId)));
    if (!agent) { res.status(403).json({ error: "Agent not found or access denied" }); return; }
  }

  const ctx = await loadCallerContext(agentId, phoneNumber);
  const memoryBlock = injectEnhancedMemory("", ctx).replace(/\n\n$/, "");

  res.json({
    phoneNumber,
    name:        ctx.profile?.name ?? null,
    callCount:   ctx.profile?.callCount ?? 0,
    lastCalledAt: ctx.profile?.lastCalledAt?.toISOString() ?? null,
    facts: ctx.facts.map(f => ({
      id:         f.id,
      key:        f.key,
      value:      f.value,
      confidence: f.confidence,
      createdAt:  f.createdAt.toISOString(),
    })),
    recentCalls: ctx.recentCalls.map(c => ({
      id:              c.id,
      summary:         c.summary ?? null,
      durationSeconds: c.durationSeconds ?? null,
      createdAt:       c.createdAt.toISOString(),
    })),
    memoryBlock,
  });
});

// ── POST /pendrive/archive ────────────────────────────────────────────────────

router.post("/pendrive/archive", async (req, res): Promise<void> => {
  const userId = ((req as any).clerkUserId as string | undefined) ?? "test-user";
  const body = PendriveArchiveBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid request", details: body.error.flatten() }); return; }
  const { agentId, phoneNumber, transcript, callId = null } = body.data;

  // Verify agent belongs to user (skip ownership check for test-user)
  if (userId !== "test-user") {
    const [agent] = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, userId)));
    if (!agent) { res.status(403).json({ error: "Agent not found or access denied" }); return; }
  }

  // Get existing profile for updateCallerProfile
  const ctx = await loadCallerContext(agentId, phoneNumber);

  // Get a managed LLM key
  const llmKey = await getManagedLlmKey();
  if (!llmKey) {
    res.status(503).json({ error: "No managed LLM key configured. Set GROQ_API_KEY or configure in Admin > Managed Keys." });
    return;
  }

  const llm = createLLMAdapter("qwen", llmKey, null);

  // Map transcript turns to ConversationTurn format
  const history = transcript.map(t => ({
    role:    t.role === "user" ? "user" as const : "assistant" as const,
    content: t.content,
  }));

  // Run the full memory pipeline (archive + LLM extraction + facts)
  await updateCallerProfile({
    agentId,
    phoneNumber,
    history,
    llm,
    existing:   ctx.profile,
    callId:     callId ?? 0,
    wasDropped: false,
  });

  // Load updated context to get episode + fact counts
  const updated = await loadCallerContext(agentId, phoneNumber);
  const newEpisodes = updated.recentCalls;
  const episodeId   = newEpisodes.length > 0 ? newEpisodes[0]!.id : 0;
  const factsCount  = updated.facts.length;

  req.log.info({ agentId, phoneNumber, callId, episodeId, factsCount }, "Pendrive archive completed");
  res.json({ ok: true, factsExtracted: factsCount, episodeId });
});

// ── GET /pendrive/bolna-config ────────────────────────────────────────────────
// No auth required — matches webhook TEST_MODE_USER_ID pattern

const BOLNA_TEST_USER_ID = "test-user";

router.get("/pendrive/bolna-config", async (req, res): Promise<void> => {
  const userId = ((req as any).clerkUserId as string | undefined) ?? BOLNA_TEST_USER_ID;
  const key = `pendrive_bolna_config_${userId}`;
  const [row] = await db
    .select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, key));

  if (!row?.value) {
    res.json({ configured: false, agentId: null, apiKeyHint: null });
    return;
  }

  try {
    const config = JSON.parse(row.value) as { apiKey: string; agentId: string };
    res.json({
      configured: true,
      agentId: config.agentId,
      apiKeyHint: config.apiKey ? `...${config.apiKey.slice(-6)}` : null,
    });
  } catch {
    res.json({ configured: false, agentId: null, apiKeyHint: null });
  }
});

// ── POST /pendrive/bolna-config ───────────────────────────────────────────────

router.post("/pendrive/bolna-config", async (req, res): Promise<void> => {
  const userId = ((req as any).clerkUserId as string | undefined) ?? BOLNA_TEST_USER_ID;
  const { apiKey, agentId } = req.body as { apiKey?: string; agentId?: string };

  if (!apiKey?.trim() || !agentId?.trim()) {
    res.status(400).json({ error: "apiKey and agentId are required" });
    return;
  }

  const key = `pendrive_bolna_config_${userId}`;
  const value = JSON.stringify({ apiKey: apiKey.trim(), agentId: agentId.trim() });

  await db
    .insert(platformSettingsTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: platformSettingsTable.key, set: { value } });

  req.log.info({ userId, agentId: agentId.trim() }, "Pendrive: Bolna config saved");
  res.json({ ok: true, agentId: agentId.trim(), apiKeyHint: `...${apiKey.trim().slice(-6)}` });
});

// ── DELETE /pendrive/bolna-config ─────────────────────────────────────────────

router.delete("/pendrive/bolna-config", async (req, res): Promise<void> => {
  const userId = ((req as any).clerkUserId as string | undefined) ?? BOLNA_TEST_USER_ID;
  const key = `pendrive_bolna_config_${userId}`;
  await db.delete(platformSettingsTable).where(eq(platformSettingsTable.key, key));
  res.json({ ok: true });
});

export default router;

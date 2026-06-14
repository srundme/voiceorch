/**
 * Pendrive LLM Proxy
 *
 * An OpenAI-compatible endpoint that sits between any voice AI platform
 * (Bolna, VAPI, Retell, …) and any LLM.  Every request flows through here:
 *
 *   1. Validates the Pendrive API key (pd_live_...)
 *   2. Extracts the caller's phone number from a marker in the system message
 *   3. Loads caller memory from Pendrive's DB
 *   4. Injects the memory block into the messages array (NOT the agent's stored prompt)
 *   5. Forwards the enriched request to the real LLM (streaming-aware)
 *
 * Platform setup (Bolna example):
 *   LLM base_url  → https://<your-domain>/api/pendrive/llm-proxy
 *   LLM api_key   → pd_live_... (your Pendrive API key)
 *   System prompt → add:  <!-- pendrive:phone:%(to_number)s -->
 *                  Bolna substitutes %(to_number)s → real phone before sending to us.
 *
 * Config endpoints:
 *   GET    /api/pendrive/llm-proxy/config
 *   PUT    /api/pendrive/llm-proxy/config
 *   DELETE /api/pendrive/llm-proxy/config
 *
 * Proxy endpoint (OpenAI-compatible):
 *   POST   /api/pendrive/llm-proxy/v1/chat/completions
 */

import { Router, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { eq, and, isNull } from "drizzle-orm";
import {
  db,
  userApiKeysTable,
  platformSettingsTable,
  agentsTable,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { loadCallerContext, injectEnhancedMemory } from "../orchestration/callerMemory.js";

const router = Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const CONFIG_KEY_PREFIX    = "pendrive_llm_proxy_config_";
const TEST_MODE_USER_ID    = "test-user";
const PHONE_TAG_RE         = /<!--\s*pendrive:phone:([\+\d]+)\s*-->/i;
// Fallback: any E.164-ish number already substituted in system message
const E164_INLINE_RE       = /(?:caller[:\s]+|phone[:\s]+|number[:\s]+)(\+\d{7,15})/i;

// ── In-memory caches (avoid repeat DB hits on every LLM turn) ─────────────────
//
// A voice call typically produces 10-30 LLM turns.  Without caching every turn
// would pay ~20-40 ms in sequential DB lookups before the fetch to the real LLM
// even starts.  With caches the hot path is pure in-process hash-map lookups.
//
//   authCache   — api-key-hash → userId,  5 min TTL
//   configCache — userId       → config,  60 s TTL  (busted on PUT/DELETE)
//   agentCache  — userId       → agentId, 5 min TTL

interface CacheEntry<T> { value: T; expiresAt: number; }

const authCache:   Map<string, CacheEntry<string>> = new Map();
const configCache: Map<string, CacheEntry<LlmProxyConfig | null>> = new Map();
const agentCache:  Map<string, CacheEntry<number | null>> = new Map();

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const e = map.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expiresAt) { map.delete(key); return undefined; }
  return e.value;
}
function cacheSet<T>(map: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): void {
  map.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface LlmProxyConfig {
  targetBaseUrl: string;
  targetApiKey: string;
  targetModel: string | null;
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool" | string;
  content: string | null;
  [key: string]: unknown;
}

// ── Auth helper ───────────────────────────────────────────────────────────────

async function resolveUser(req: Request): Promise<string | null> {
  const auth = (req.headers["authorization"] ?? "") as string;
  const raw  = auth.replace(/^bearer\s+/i, "").trim();

  if (!raw || !raw.startsWith("pd_live_")) {
    return TEST_MODE_USER_ID;
  }

  const hash   = createHash("sha256").update(raw).digest("hex");
  const cached = cacheGet(authCache, hash);
  if (cached !== undefined) return cached;

  const [row] = await db
    .select({ userId: userApiKeysTable.userId })
    .from(userApiKeysTable)
    .where(and(eq(userApiKeysTable.keyHash, hash), isNull(userApiKeysTable.revokedAt)));

  if (!row) return null;

  cacheSet(authCache, hash, row.userId, 5 * 60_000);

  db.update(userApiKeysTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(userApiKeysTable.keyHash, hash))
    .catch(() => {});

  return row.userId;
}

// ── Config helpers ────────────────────────────────────────────────────────────

async function getLlmProxyConfig(userId: string): Promise<LlmProxyConfig | null> {
  const cached = cacheGet(configCache, userId);
  if (cached !== undefined) return cached;

  const [row] = await db
    .select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, CONFIG_KEY_PREFIX + userId));
  const result = row?.value ? (() => { try { return JSON.parse(row.value) as LlmProxyConfig; } catch { return null; } })() : null;
  cacheSet(configCache, userId, result, 60_000);
  return result;
}

async function setLlmProxyConfig(userId: string, cfg: LlmProxyConfig): Promise<void> {
  const key = CONFIG_KEY_PREFIX + userId;
  await db
    .insert(platformSettingsTable)
    .values({ key, value: JSON.stringify(cfg) })
    .onConflictDoUpdate({ target: platformSettingsTable.key, set: { value: JSON.stringify(cfg) } });
  cacheSet(configCache, userId, cfg, 60_000);
}

async function deleteLlmProxyConfig(userId: string): Promise<void> {
  await db.delete(platformSettingsTable)
    .where(eq(platformSettingsTable.key, CONFIG_KEY_PREFIX + userId));
  configCache.delete(userId);
}

// ── Agent resolution ─────────────────────────────────────────────────────────

async function resolveAgentId(userId: string): Promise<number | null> {
  const cached = cacheGet(agentCache, userId);
  if (cached !== undefined) return cached;

  const [row] = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(eq(agentsTable.userId, userId));
  const result = row?.id ?? null;
  cacheSet(agentCache, userId, result, 5 * 60_000);
  return result;
}

// ── Phone extraction ─────────────────────────────────────────────────────────

function extractPhone(messages: OpenAIMessage[]): { phone: string | null; cleaned: OpenAIMessage[] } {
  let phone: string | null = null;

  const cleaned = messages.map(msg => {
    if (msg.role !== "system" || typeof msg.content !== "string") return msg;

    // Primary: <!-- pendrive:phone:+91... -->
    const tagMatch = PHONE_TAG_RE.exec(msg.content);
    if (tagMatch) {
      phone = tagMatch[1]!;
      return { ...msg, content: msg.content.replace(PHONE_TAG_RE, "").trim() };
    }

    // Fallback: inline label like "Caller: +91..."
    const labelMatch = E164_INLINE_RE.exec(msg.content);
    if (labelMatch) {
      phone = labelMatch[1]!;
      // Leave in prompt as-is (it may be useful context for the LLM)
    }

    return msg;
  });

  return { phone, cleaned };
}

// ── Memory injection ─────────────────────────────────────────────────────────

function injectIntoMessages(messages: OpenAIMessage[], memoryBlock: string): OpenAIMessage[] {
  if (!memoryBlock.trim()) return messages;

  const idx = messages.findIndex(m => m.role === "system");
  if (idx >= 0) {
    const updated = [...messages];
    updated[idx] = {
      ...updated[idx],
      content: (updated[idx]!.content ?? "") + "\n\n" + memoryBlock,
    };
    return updated;
  }

  // No system message — prepend one
  return [{ role: "system", content: memoryBlock }, ...messages];
}

// ── Config routes ─────────────────────────────────────────────────────────────

router.get("/pendrive/llm-proxy/config", async (req: Request, res: Response): Promise<void> => {
  const userId = ((req as any).clerkUserId as string | undefined) ?? TEST_MODE_USER_ID;
  const cfg    = await getLlmProxyConfig(userId);
  if (!cfg) { res.json({ configured: false }); return; }
  res.json({
    configured:     true,
    targetBaseUrl:  cfg.targetBaseUrl,
    targetModel:    cfg.targetModel ?? null,
    apiKeyHint:     cfg.targetApiKey.slice(0, 8) + "••••••••",
  });
});

router.put("/pendrive/llm-proxy/config", async (req: Request, res: Response): Promise<void> => {
  const userId = ((req as any).clerkUserId as string | undefined) ?? TEST_MODE_USER_ID;
  const { targetBaseUrl, targetApiKey, targetModel } = req.body ?? {};
  if (!targetBaseUrl?.trim() || !targetApiKey?.trim()) {
    res.status(400).json({ error: "targetBaseUrl and targetApiKey are required" });
    return;
  }
  const cfg: LlmProxyConfig = {
    targetBaseUrl: targetBaseUrl.trim().replace(/\/$/, ""),
    targetApiKey:  targetApiKey.trim(),
    targetModel:   targetModel?.trim() || null,
  };
  await setLlmProxyConfig(userId, cfg);
  logger.info({ userId, targetBaseUrl: cfg.targetBaseUrl }, "Pendrive LLM proxy config saved");
  res.json({ configured: true, targetBaseUrl: cfg.targetBaseUrl, targetModel: cfg.targetModel, apiKeyHint: cfg.targetApiKey.slice(0, 8) + "••••••••" });
});

router.delete("/pendrive/llm-proxy/config", async (req: Request, res: Response): Promise<void> => {
  const userId = ((req as any).clerkUserId as string | undefined) ?? TEST_MODE_USER_ID;
  await deleteLlmProxyConfig(userId);
  res.json({ ok: true });
});

// ── POST /pendrive/llm-proxy/v1/chat/completions ──────────────────────────────

router.post("/pendrive/llm-proxy/v1/chat/completions", async (req: Request, res: Response): Promise<void> => {
  // 1. Auth
  const userId = await resolveUser(req);
  if (!userId) {
    res.status(401).json({ error: { message: "Invalid Pendrive API key", type: "invalid_request_error" } });
    return;
  }

  // 2. Load proxy config
  const cfg = await getLlmProxyConfig(userId);
  if (!cfg) {
    res.status(503).json({ error: { message: "LLM proxy not configured. Set up your target LLM in Pendrive → API Keys → LLM Proxy.", type: "invalid_request_error" } });
    return;
  }

  // 3. Parse incoming OpenAI-format body
  const body = req.body as {
    model?: string;
    messages?: OpenAIMessage[];
    stream?: boolean;
    [key: string]: unknown;
  };

  const messages: OpenAIMessage[] = body.messages ?? [];

  // 4. Extract phone number from system message marker
  const { phone, cleaned: cleanedMessages } = extractPhone(messages);

  logger.info({ userId, phone, model: body.model, stream: body.stream }, "Pendrive LLM proxy: request received");

  // 5. Load caller memory if phone found
  let memoryBlock = "";
  if (phone) {
    try {
      const agentId = await resolveAgentId(userId);
      if (agentId) {
        const ctx     = await loadCallerContext(agentId, phone);
        memoryBlock   = injectEnhancedMemory("", ctx).trim();
        logger.info({ userId, phone, agentId, callCount: ctx.profile?.callCount ?? 0, hasMemory: !!memoryBlock }, "Pendrive LLM proxy: caller memory loaded");
      }
    } catch (err) {
      logger.warn({ err, phone }, "Pendrive LLM proxy: memory load failed — continuing without memory");
    }
  } else {
    logger.info({ userId }, "Pendrive LLM proxy: no phone found in system message — forwarding without memory");
  }

  // 6. Inject memory into messages
  const enrichedMessages = injectIntoMessages(cleanedMessages, memoryBlock);

  // 7. Build forwarded body
  const forwardModel = cfg.targetModel || body.model;
  const forwardBody  = { ...body, messages: enrichedMessages, model: forwardModel };

  // 8. Forward to real LLM
  const targetUrl = `${cfg.targetBaseUrl}/chat/completions`;
  let forwardRes: globalThis.Response;
  try {
    forwardRes = await fetch(targetUrl, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${cfg.targetApiKey}`,
        "Content-Type":  "application/json",
        ...(req.headers["anthropic-version"] ? { "anthropic-version": req.headers["anthropic-version"] as string } : {}),
      },
      body: JSON.stringify(forwardBody),
    });
  } catch (err) {
    logger.error({ err, targetUrl }, "Pendrive LLM proxy: forward fetch failed");
    res.status(502).json({ error: { message: "Failed to reach target LLM", type: "proxy_error" } });
    return;
  }

  if (!forwardRes.ok && !body.stream) {
    const errBody = await forwardRes.text().catch(() => "");
    logger.warn({ status: forwardRes.status, body: errBody.slice(0, 300) }, "Pendrive LLM proxy: target LLM returned error");
    res.status(forwardRes.status).send(errBody);
    return;
  }

  // 9. Stream or buffer response back to caller
  const contentType = forwardRes.headers.get("content-type") ?? "application/json";
  res.status(forwardRes.status);
  res.setHeader("Content-Type", contentType);

  // Copy relevant headers
  for (const key of ["x-request-id", "openai-processing-ms", "openai-version"]) {
    const val = forwardRes.headers.get(key);
    if (val) res.setHeader(key, val);
  }

  if (forwardRes.body) {
    const nodeStream = Readable.fromWeb(forwardRes.body as Parameters<typeof Readable.fromWeb>[0]);
    nodeStream.pipe(res);
    nodeStream.on("error", (err) => {
      logger.error({ err }, "Pendrive LLM proxy: stream error");
      if (!res.headersSent) res.status(502).end();
    });
  } else {
    res.end();
  }
});

export default router;

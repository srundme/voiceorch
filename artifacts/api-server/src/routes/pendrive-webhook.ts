/**
 * Pendrive — Universal Webhook Endpoint
 *
 * Zero-config memory for any voice AI platform (VAPI, Retell, Bolna, generic).
 * Auth: Authorization: Bearer pd_live_... (Pendrive API key)
 *
 * POST /pendrive/webhook
 *   — call.started → fetch enhanced memory context → return formatted block
 *   — call.ended   → background archive + LLM extraction (non-blocking 200)
 *
 * Platform detection (auto from payload shape):
 *   VAPI    — body.message.type = "assistant-request" | "end-of-call-report"
 *   Retell  — body.event = "call_started" | "call_ended"
 *   Generic — body.event = "call.started" | "call.ended"
 *             OR body.type = "call.started" | "call.ended"
 */

import { Router } from "express";
import type { IRouter, Request, Response } from "express";
import { createHash } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  userApiKeysTable,
  callerProfilesTable,
  platformSettingsTable,
  agentsTable,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import {
  loadCallerContext,
  injectEnhancedMemory,
  updateCallerProfile,
} from "../orchestration/callerMemory.js";
import { createLLMAdapter } from "../orchestration/adapters/llm/index.js";

const router: IRouter = Router();

// ── Types ─────────────────────────────────────────────────────────────────────

type Platform = "vapi" | "retell" | "generic";

interface ParsedEvent {
  type: "call.started" | "call.ended" | "unknown";
  phoneNumber: string | null;
  agentId: string | null;
  transcript: string | null;
  durationSeconds: number | null;
  platform: Platform;
}

// ── Key auth middleware ───────────────────────────────────────────────────────

async function resolvePendriveKey(req: Request): Promise<{ userId: string; keyId: number } | null> {
  const authHeader = req.headers["authorization"];
  const rawKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!rawKey || !rawKey.startsWith("pd_")) return null;

  const hash = createHash("sha256").update(rawKey).digest("hex");

  const [row] = await db
    .select({ id: userApiKeysTable.id, userId: userApiKeysTable.userId })
    .from(userApiKeysTable)
    .where(and(
      eq(userApiKeysTable.keyHash, hash),
      sql`${userApiKeysTable.keyPrefix} LIKE ${"pd_%"}`,
    ))
    .limit(1);

  if (!row) return null;

  // Update last used timestamp (fire and forget)
  db.update(userApiKeysTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(userApiKeysTable.id, row.id))
    .catch(() => {});

  return { userId: row.userId, keyId: row.id };
}

// ── Platform detection ────────────────────────────────────────────────────────

function parseEvent(body: any): ParsedEvent {
  // ── VAPI ──
  if (body?.message?.type) {
    const msg = body.message;
    const call = msg.call ?? {};
    const phone = call.customer?.number ?? call.phoneNumber ?? null;
    const agentId = call.assistantId ?? call.id ?? null;

    if (msg.type === "assistant-request") {
      return { type: "call.started", phoneNumber: phone, agentId, transcript: null, durationSeconds: null, platform: "vapi" };
    }
    if (msg.type === "end-of-call-report") {
      const artifact = msg.artifact ?? {};
      const transcript = artifact.transcript ?? artifact.messages
        ?.map((m: any) => `${m.role === "user" ? "Caller" : "Agent"}: ${m.content ?? m.message ?? ""}`)
        .join("\n") ?? null;
      const duration = msg.durationSeconds ?? call.duration ?? null;
      return { type: "call.ended", phoneNumber: phone, agentId, transcript, durationSeconds: duration, platform: "vapi" };
    }
    return { type: "unknown", phoneNumber: phone, agentId: null, transcript: null, durationSeconds: null, platform: "vapi" };
  }

  // ── Retell ──
  if (body?.event === "call_started" || body?.event === "call_ended") {
    const call = body.call ?? {};
    const phone = call.from_number ?? call.phoneNumber ?? body.phoneNumber ?? null;
    const agentId = call.agent_id ?? body.agentId ?? null;

    if (body.event === "call_started") {
      return { type: "call.started", phoneNumber: phone, agentId, transcript: null, durationSeconds: null, platform: "retell" };
    }
    const transcript = call.transcript ?? body.transcript ?? null;
    const duration = call.duration_ms ? Math.round(call.duration_ms / 1000) : (body.durationSeconds ?? null);
    return { type: "call.ended", phoneNumber: phone, agentId, transcript, durationSeconds: duration, platform: "retell" };
  }

  // ── Bolna flat format (no event field, just { id, agent_id, transcript, conversation_duration, ... }) ──
  if (body?.agent_id && body?.id && !body?.event && !body?.type && !body?.message) {
    const phone = body?.from_number ?? body?.to_number ?? body?.phone_number ?? body?.customer_number ?? null;
    const agentId = body.agent_id ?? null;
    const transcript = typeof body.transcript === "string" && body.transcript.trim().length > 0
      ? body.transcript : null;
    const duration = body?.conversation_duration ?? null;

    if (!transcript || (typeof duration === "number" && duration === 0)) {
      return { type: "call.started", phoneNumber: phone, agentId, transcript: null, durationSeconds: null, platform: "generic" };
    }
    return { type: "call.ended", phoneNumber: phone, agentId, transcript, durationSeconds: duration, platform: "generic" };
  }

  // ── Generic / Bolna legacy ──
  const event = body?.event ?? body?.type ?? "";
  const phone = body?.phoneNumber ?? body?.phone_number ?? body?.from ?? null;
  const agentId = body?.agentId ?? body?.agent_id ?? null;

  if (event === "call.started" || event === "call_start") {
    return { type: "call.started", phoneNumber: phone, agentId, transcript: null, durationSeconds: null, platform: "generic" };
  }
  if (event === "call.ended" || event === "call_end" || event === "call_complete") {
    const rawTranscript = body?.transcript ?? body?.messages ?? null;
    let transcript: string | null = null;
    if (typeof rawTranscript === "string") transcript = rawTranscript;
    else if (Array.isArray(rawTranscript)) {
      transcript = rawTranscript
        .map((t: any) => `${t.role === "user" ? "Caller" : "Agent"}: ${t.content ?? t.text ?? ""}`)
        .join("\n");
    }
    const duration = body?.durationSeconds ?? body?.duration_seconds ?? body?.duration ?? null;
    return { type: "call.ended", phoneNumber: phone, agentId, transcript, durationSeconds: duration, platform: "generic" };
  }

  return { type: "unknown", phoneNumber: phone, agentId: null, transcript: null, durationSeconds: null, platform: "generic" };
}

// ── Bolna API auto-injection ──────────────────────────────────────────────────

const PENDRIVE_MARKER_START = "\n\n<!-- PENDRIVE:START -->";
const PENDRIVE_MARKER_END   = "<!-- PENDRIVE:END -->";

async function getBolnaConfig(userId: string): Promise<{ apiKey: string; agentId: string } | null> {
  const key = `pendrive_bolna_config_${userId}`;
  const [row] = await db
    .select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, key));
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as { apiKey: string; agentId: string };
  } catch {
    return null;
  }
}

async function pushMemoryToBolnaAgent(apiKey: string, agentId: string, memoryBlock: string): Promise<void> {
  const base = "https://api.bolna.dev";

  // 1. Fetch current agent
  const getRes = await fetch(`${base}/agent/${agentId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!getRes.ok) {
    logger.warn({ agentId, status: getRes.status }, "Bolna: GET agent failed");
    return;
  }
  const agent = await getRes.json() as any;

  // 2. Find the system prompt field (Bolna uses agent_config.agent_task)
  const currentPrompt: string =
    agent?.agent_config?.agent_task ??
    agent?.agent_prompts?.task_description ??
    "";

  // 3. Strip previous Pendrive block if present, append fresh one
  const stripped = currentPrompt
    .replace(new RegExp(`${PENDRIVE_MARKER_START}[\\s\\S]*?${PENDRIVE_MARKER_END}`, "g"), "")
    .trimEnd();

  const newPrompt = stripped +
    PENDRIVE_MARKER_START + "\n" +
    memoryBlock + "\n" +
    PENDRIVE_MARKER_END;

  // 4. Patch the agent — try common field locations
  const patch: any = { ...agent };
  if (patch?.agent_config?.agent_task !== undefined) {
    patch.agent_config = { ...patch.agent_config, agent_task: newPrompt };
  } else if (patch?.agent_prompts?.task_description !== undefined) {
    patch.agent_prompts = { ...patch.agent_prompts, task_description: newPrompt };
  } else {
    patch.agent_config = { ...(patch.agent_config ?? {}), agent_task: newPrompt };
  }

  const putRes = await fetch(`${base}/agent/${agentId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });

  if (!putRes.ok) {
    const body = await putRes.text().catch(() => "");
    logger.warn({ agentId, status: putRes.status, body }, "Bolna: PUT agent failed");
  } else {
    logger.info({ agentId }, "Bolna: memory injected into agent system prompt");
  }
}

// ── Managed LLM key ───────────────────────────────────────────────────────────

async function getManagedLlmKey(): Promise<string | null> {
  const [row] = await db
    .select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, "managed_qwen_key"));
  const dbVal = row?.value?.trim() ?? null;
  if (dbVal) return dbVal;
  return (process.env["GROQ_API_KEY"] ?? "").trim() || null;
}

// ── Auto-provision default Pendrive agent per user ────────────────────────────

const DEFAULT_AGENT_CACHE = new Map<string, number>();

async function getOrCreatePendriveAgent(userId: string): Promise<number | null> {
  if (DEFAULT_AGENT_CACHE.has(userId)) return DEFAULT_AGENT_CACHE.get(userId)!;

  // Find existing Pendrive shadow agent
  const existing = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(and(
      eq(agentsTable.userId, userId),
      sql`${agentsTable.name} = ${"Pendrive Memory Agent"}`,
    ))
    .limit(1);

  if (existing[0]) {
    DEFAULT_AGENT_CACHE.set(userId, existing[0].id);
    return existing[0].id;
  }

  // Create a minimal shadow agent — provider fields are placeholders (memory-only agent)
  try {
    const [created] = await db
      .insert(agentsTable)
      .values({
        userId,
        name:              "Pendrive Memory Agent",
        status:            "inactive",
        systemPrompt:      "Pendrive memory agent — not used for live calls.",
        asrProvider:       "deepgram",
        llmProvider:       "openai",
        ttsProvider:       "elevenlabs",
        telephonyProvider: "twilio",
      } as any)
      .returning({ id: agentsTable.id });

    if (created) {
      DEFAULT_AGENT_CACHE.set(userId, created.id);
      return created.id;
    }
  } catch (err) {
    logger.warn({ err, userId }, "Failed to auto-create Pendrive shadow agent");
  }

  return null;
}

// ── Format response by platform ───────────────────────────────────────────────

function formatStartedResponse(platform: Platform, memoryBlock: string, callerName: string | null) {
  switch (platform) {
    case "vapi":
      return {
        assistantOverrides: {
          variableValues: { caller_memory: memoryBlock },
          firstMessage: callerName
            ? `Hello ${callerName}, welcome back!`
            : "Hello! How can I help you today?",
        },
        memory: memoryBlock,
        callerName,
      };

    case "retell":
      return {
        response_type: "memory",
        memory: memoryBlock,
        caller_name: callerName,
      };

    default:
      return {
        memory: memoryBlock,
        callerName,
        systemPromptSuffix: memoryBlock,
      };
  }
}

// ── POST /pendrive/webhook ────────────────────────────────────────────────────

// TODO: re-enable auth once testing is complete
const TEST_MODE_USER_ID = "test-user";

router.post("/pendrive/webhook", async (req: Request, res: Response): Promise<void> => {
  const { userId } = { userId: TEST_MODE_USER_ID };

  const event = parseEvent(req.body);

  // Allow ?phone= query param to override/supply phone number (useful for Bolna which doesn't include it in payload)
  const queryPhone = (req.query["phone"] as string | undefined)?.trim() || null;
  if (queryPhone && !event.phoneNumber) {
    (event as any).phoneNumber = queryPhone;
  }

  logger.info({ eventType: event.type, platform: event.platform, phone: event.phoneNumber ?? "none", hasTranscript: !!event.transcript }, "Pendrive webhook: event parsed");

  if (event.type === "unknown") {
    res.status(200).json({ ok: true, message: "Event type not recognized — no action taken" });
    return;
  }

  if (!event.phoneNumber) {
    res.status(400).json({ error: "Could not extract phone number from webhook payload" });
    return;
  }

  const agentId = await getOrCreatePendriveAgent(userId);
  if (!agentId) {
    res.status(503).json({ error: "Could not provision Pendrive memory agent" });
    return;
  }

  // ── call.started — fetch memory, return immediately ──────────────────────
  if (event.type === "call.started") {
    try {
      const ctx = await loadCallerContext(agentId, event.phoneNumber);
      const memoryBlock = injectEnhancedMemory("", ctx).split("\n\n")[0] ?? "";
      const callerName = ctx.profile?.name ?? ctx.facts.find(f => f.key === "name")?.value ?? null;

      logger.info({ agentId, phone: event.phoneNumber, platform: event.platform, callCount: ctx.profile?.callCount ?? 0 }, "Pendrive webhook: call.started — memory served");

      // Auto-push memory into Bolna agent system prompt if configured (fire-and-forget)
      if (memoryBlock.trim()) {
        getBolnaConfig(userId).then(bolna => {
          if (bolna) {
            pushMemoryToBolnaAgent(bolna.apiKey, bolna.agentId, memoryBlock).catch(err => {
              logger.warn({ err }, "Pendrive: Bolna auto-inject failed (non-blocking)");
            });
          }
        }).catch(() => {});
      }

      res.json(formatStartedResponse(event.platform, memoryBlock, callerName));
    } catch (err) {
      logger.error({ err, agentId, phone: event.phoneNumber }, "Pendrive webhook: call.started failed");
      res.status(500).json({ error: "Failed to load caller memory" });
    }
    return;
  }

  // ── call.ended — respond immediately, archive in background ─────────────
  res.json({ ok: true, message: "Archiving transcript in background" });

  if (!event.transcript || event.transcript.trim().length < 20) {
    logger.info({ agentId, phone: event.phoneNumber, platform: event.platform }, "Pendrive webhook: call.ended — transcript too short, skipping archive");
    return;
  }

  (async () => {
    try {
      const llmKey = await getManagedLlmKey();
      if (!llmKey) {
        logger.warn({ agentId }, "Pendrive webhook: no managed LLM key — skipping LLM extraction");
        return;
      }

      const ctx = await loadCallerContext(agentId, event.phoneNumber!);
      const llm = createLLMAdapter("qwen", llmKey, null);

      const history = event.transcript!
        .split("\n")
        .filter(line => line.includes(": "))
        .map(line => {
          const colonIdx = line.indexOf(": ");
          const speaker = line.slice(0, colonIdx).toLowerCase().trim();
          const content = line.slice(colonIdx + 2).trim();
          return {
            role: (speaker.includes("caller") || speaker.includes("user") || speaker.includes("customer"))
              ? "user" as const
              : "assistant" as const,
            content,
          };
        })
        .filter(t => t.content.length > 0);

      await updateCallerProfile({
        agentId,
        phoneNumber:     event.phoneNumber!,
        history,
        llm,
        existing:        ctx.profile,
        callId:          0,
        wasDropped:      false,
        durationSeconds: event.durationSeconds ?? undefined,
      });

      logger.info({ agentId, phone: event.phoneNumber, platform: event.platform }, "Pendrive webhook: call.ended — archive complete");
    } catch (err) {
      logger.error({ err, agentId, phone: event.phoneNumber }, "Pendrive webhook: background archive failed");
    }
  })();
});

export default router;

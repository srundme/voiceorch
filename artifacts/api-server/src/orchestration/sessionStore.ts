/**
 * Redis-backed session store.
 *
 * Two key spaces:
 *   session:{sessionId}   — session metadata hash (TTL = maxDuration + 10 min buffer)
 *   convo:{callId}        — conversation history JSON (same TTL)
 *   sessions:active       — Redis set of currently active sessionIds (for monitoring)
 *
 * The in-memory Map in session.ts remains the authoritative source for the live
 * pipeline object (WebSocket streams cannot be serialised).  Redis is the durable
 * mirror that survives process restarts and is visible across multiple instances.
 */

import { getRedis } from "../lib/redis.js";
import type { ConversationTurn } from "./types.js";
import { logger } from "../lib/logger.js";

export interface SessionMeta {
  callId: number;
  agentId: number;
  startedAt: string;       // ISO string
  wasTransferred: boolean;
  transferredTo: string | null;
  status: "active" | "ended" | "failed";
  sttTotal: number;
  llmTotal: number;
  ttsTotal: number;
  metricsCount: number;
  /** AI-to-AI transfer marker */
  transferType?: "agent";
  targetAgentId?: number;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function sessionKey(sessionId: string)  { return `session:${sessionId}`; }
function convoKey(callId: number)       { return `convo:${callId}`; }
const ACTIVE_SET = "sessions:active";

// ── write ─────────────────────────────────────────────────────────────────────

export async function saveSessionMeta(
  sessionId: string,
  meta: SessionMeta,
  ttlSeconds: number
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await Promise.all([
      r.set(sessionKey(sessionId), JSON.stringify(meta), { ex: ttlSeconds }),
      r.sadd(ACTIVE_SET, sessionId),
    ]);
  } catch (err) {
    logger.warn({ sessionId, err }, "Redis: saveSessionMeta failed");
  }
}

export async function patchSessionMeta(
  sessionId: string,
  patch: Partial<SessionMeta>,
  ttlSeconds: number
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    const existing = await r.get(sessionKey(sessionId));
    const current: SessionMeta = existing
      ? (typeof existing === "string" ? JSON.parse(existing) : existing) as SessionMeta
      : ({} as SessionMeta);
    const updated = { ...current, ...patch };
    await r.set(sessionKey(sessionId), JSON.stringify(updated), { ex: ttlSeconds });
  } catch (err) {
    logger.warn({ sessionId, err }, "Redis: patchSessionMeta failed");
  }
}

export async function saveConversation(
  callId: number,
  history: ConversationTurn[],
  ttlSeconds: number
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(convoKey(callId), JSON.stringify(history), { ex: ttlSeconds });
  } catch (err) {
    logger.warn({ callId, err }, "Redis: saveConversation failed");
  }
}

export async function removeSession(sessionId: string, callId: number): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await Promise.all([
      r.srem(ACTIVE_SET, sessionId),
      // Keep convo key alive for 1 hour after call ends for post-call analytics
      r.expire(convoKey(callId), 3600),
    ]);
  } catch (err) {
    logger.warn({ sessionId, err }, "Redis: removeSession cleanup failed");
  }
}

// ── read ──────────────────────────────────────────────────────────────────────

export async function getSessionMeta(sessionId: string): Promise<SessionMeta | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const raw = await r.get(sessionKey(sessionId));
    return raw ? ((typeof raw === "string" ? JSON.parse(raw) : raw) as SessionMeta) : null;
  } catch (err) {
    logger.warn({ sessionId, err }, "Redis: getSessionMeta failed");
    return null;
  }
}

export async function getConversation(callId: number): Promise<ConversationTurn[]> {
  const r = getRedis();
  if (!r) return [];
  try {
    const raw = await r.get<string>(convoKey(callId));
    return raw ? (JSON.parse(raw as string) as ConversationTurn[]) : [];
  } catch (err) {
    logger.warn({ callId, err }, "Redis: getConversation failed");
    return [];
  }
}

export async function getActiveSessions(): Promise<string[]> {
  const r = getRedis();
  if (!r) return [];
  try {
    return await r.smembers(ACTIVE_SET);
  } catch (err) {
    logger.warn({ err }, "Redis: getActiveSessions failed");
    return [];
  }
}

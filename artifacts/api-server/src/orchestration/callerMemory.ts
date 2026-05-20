/**
 * Cross-call caller memory
 * ─────────────────────────────────────────────────────────────────
 * On every call start: look up the caller's profile by (agentId, phoneNumber)
 * and prepend a memory block to the system prompt.
 *
 * On every call end: fire-and-forget LLM extraction to update the profile.
 * Works for both inbound and outbound telephony.
 * Webcall (browser test calls) is skipped — no stable phone identifier.
 */

import { db, callerProfilesTable, scheduledCallbacksTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import type { ConversationTurn } from "./types.js";
import type { createLLMAdapter } from "./adapters/llm/index.js";
import { logger } from "../lib/logger.js";

// ── Types ────────────────────────────────────────────────────────────────────

type LLMAdapter = ReturnType<typeof createLLMAdapter>;

export interface CallerProfile {
  id: number;
  agentId: number;
  phoneNumber: string;
  name: string | null;
  summary: string | null;
  callCount: number;
  lastCalledAt: Date | null;
  lastCallDropped: boolean;
  lastCallDroppedAt: Date | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true if the number looks like a real E.164 phone number.
 * Used to tell inbound callers (real numbers) apart from special values
 * like "outbound", "webcall", "browser", or empty strings.
 */
export function isRealPhoneNumber(n: string): boolean {
  return /^\+?\d{7,15}$/.test(n.trim());
}

/**
 * Pick the "human" party from a call's fromNumber / toNumber.
 * Inbound: fromNumber is the human.
 * Outbound: toNumber is the human.
 */
export function humanPhone(fromNumber: string, toNumber: string): string | null {
  if (isRealPhoneNumber(fromNumber)) return fromNumber.trim();
  if (isRealPhoneNumber(toNumber))   return toNumber.trim();
  return null;   // webcall / test — no real number
}

// ── Load ─────────────────────────────────────────────────────────────────────

export async function loadCallerProfile(
  agentId: number,
  phoneNumber: string,
): Promise<CallerProfile | null> {
  const [row] = await db
    .select()
    .from(callerProfilesTable)
    .where(
      and(
        eq(callerProfilesTable.agentId, agentId),
        eq(callerProfilesTable.phoneNumber, phoneNumber),
      ),
    );
  return row ?? null;
}

// ── Inject into system prompt ─────────────────────────────────────────────────

/** Threshold for treating a dropped call as "recent" (1 hour). */
const DROPPED_CALL_WINDOW_MS = 60 * 60 * 1000;

/**
 * Build a concise memory header and prepend it to the system prompt.
 * If the previous call was dropped within the last hour, includes a
 * continuation cue so the agent picks up naturally rather than starting fresh.
 */
export function injectCallerMemory(
  systemPrompt: string,
  profile: CallerProfile,
): string {
  const daysSince =
    profile.lastCalledAt
      ? Math.floor((Date.now() - profile.lastCalledAt.getTime()) / 86_400_000)
      : null;

  const isRecentDrop =
    profile.lastCallDropped &&
    profile.lastCallDroppedAt != null &&
    Date.now() - profile.lastCallDroppedAt.getTime() < DROPPED_CALL_WINDOW_MS;

  const lastCallStr = (() => {
    if (daysSince === null) return null;
    const base = daysSince === 0 ? "today" : daysSince === 1 ? "yesterday" : `${daysSince} days ago`;
    return isRecentDrop ? `${base} (call dropped — this is a continuation)` : base;
  })();

  const lines: string[] = [
    "=== CALLER MEMORY (from previous calls) ===",
    profile.name    ? `Name: ${profile.name}`                     : "Name: unknown",
    `Previous calls with this agent: ${profile.callCount}`,
    lastCallStr     ? `Last call: ${lastCallStr}`                 : null,
    profile.summary ? `Context: ${profile.summary}`              : null,
    isRecentDrop
      ? "IMPORTANT: The previous call was disconnected unexpectedly. This caller is calling back. Resume naturally from where you left off — acknowledge the drop briefly and continue the conversation without starting over."
      : null,
    "===========================================",
  ].filter((l): l is string => l !== null);

  return `${lines.join("\n")}\n\n${systemPrompt}`;
}

// ── Update after call ─────────────────────────────────────────────────────────

/**
 * Use the LLM to extract name + summary from the conversation, then upsert
 * the caller profile.  Should be called fire-and-forget after a call ends.
 */
export async function updateCallerProfile(opts: {
  agentId: number;
  phoneNumber: string;
  history: ConversationTurn[];
  llm: LLMAdapter;
  existing: CallerProfile | null;
  callId: number;
  wasDropped?: boolean;
}): Promise<void> {
  const { agentId, phoneNumber, history, llm, existing, callId, wasDropped = false } = opts;

  if (history.length < 2) return;   // too short to extract anything

  const transcript = history
    .map((t) => `${t.role === "user" ? "Caller" : "Agent"}: ${t.content}`)
    .join("\n");

  const priorContext = existing?.summary
    ? `Prior context from previous calls: ${existing.summary}\n\n`
    : "";

  let raw = "";
  await llm.chat(
    [
      {
        role: "user",
        content:
          `${priorContext}Given this call transcript, extract caller information.\n` +
          `Return ONLY valid JSON with exactly these fields:\n` +
          `- "name": caller's name if explicitly stated, otherwise null\n` +
          `- "summary": 1–3 sentences capturing key interests, issues, preferences, and follow-ups. Merge with prior context if available.\n\n` +
          `Transcript:\n${transcript.slice(0, 6000)}`,
      },
    ],
    "You extract caller profile information from voice call transcripts. Return only a JSON object with 'name' (string|null) and 'summary' (string) fields. Be concise and factual.",
    () => {},
    (full) => { raw = full; },
  );

  let extracted: { name?: string | null; summary?: string | null } = {};
  try {
    const jsonStr = raw.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
    extracted = JSON.parse(jsonStr) as typeof extracted;
  } catch {
    logger.warn({ agentId, phoneNumber, callId }, "Caller profile JSON parse failed — skipping update");
    return;
  }

  const now      = new Date();
  const newCount = (existing?.callCount ?? 0) + 1;

  await db
    .insert(callerProfilesTable)
    .values({
      agentId,
      phoneNumber,
      name:              extracted.name    ?? null,
      summary:           extracted.summary ?? null,
      callCount:         newCount,
      lastCalledAt:      now,
      lastCallDropped:   wasDropped,
      lastCallDroppedAt: wasDropped ? now : null,
    })
    .onConflictDoUpdate({
      target: [callerProfilesTable.agentId, callerProfilesTable.phoneNumber],
      set: {
        name:              extracted.name ? extracted.name : sql`caller_profiles.name`,
        summary:           extracted.summary ?? null,
        callCount:         newCount,
        lastCalledAt:      now,
        lastCallDropped:   wasDropped,
        lastCallDroppedAt: wasDropped ? now : null,
        updatedAt:         now,
      },
    });

  logger.info({ agentId, phoneNumber, callId, callCount: newCount, wasDropped }, "Caller profile updated");
}

// ── Detect callback requests ──────────────────────────────────────────────────

/**
 * Scan the transcript for "call me back in X minutes" style requests.
 * If detected, creates a scheduled_callbacks record so the poller can fire
 * an outbound call at the right time.
 * Should be called fire-and-forget after a call ends.
 */
export async function detectCallbackRequest(opts: {
  agentId: number;
  toNumber: string;    // human's phone number
  history: ConversationTurn[];
  llm: LLMAdapter;
  callId: number;
}): Promise<void> {
  const { agentId, toNumber, history, llm, callId } = opts;

  if (history.length < 2) return;

  const transcript = history
    .map((t) => `${t.role === "user" ? "Caller" : "Agent"}: ${t.content}`)
    .join("\n");

  let raw = "";
  await llm.chat(
    [
      {
        role: "user",
        content:
          `Analyze this call transcript and determine if the caller explicitly requested a callback after a specific delay.\n` +
          `Return ONLY valid JSON with these fields:\n` +
          `- "callbackRequested": true if caller said something like "call me back", "call me in X minutes", "call me after X mins", otherwise false\n` +
          `- "delayMinutes": the number of minutes until callback (integer), or null if not applicable\n\n` +
          `Transcript:\n${transcript.slice(0, 4000)}`,
      },
    ],
    "You detect callback scheduling requests in voice call transcripts. Return only a JSON object with 'callbackRequested' (boolean) and 'delayMinutes' (integer|null). Be conservative — only return true if the caller explicitly asked to be called back after a specific duration.",
    () => {},
    (full) => { raw = full; },
  );

  let extracted: { callbackRequested?: boolean; delayMinutes?: number | null } = {};
  try {
    const jsonStr = raw.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
    extracted = JSON.parse(jsonStr) as typeof extracted;
  } catch {
    return;
  }

  if (!extracted.callbackRequested || !extracted.delayMinutes || extracted.delayMinutes <= 0) return;

  const scheduledAt = new Date(Date.now() + extracted.delayMinutes * 60_000);

  await db.insert(scheduledCallbacksTable).values({
    agentId,
    toNumber,
    scheduledAt,
    createdFromCallId: callId,
    status: "pending",
  });

  logger.info(
    { callId, agentId, toNumber, delayMinutes: extracted.delayMinutes, scheduledAt },
    "Scheduled callback registered",
  );
}

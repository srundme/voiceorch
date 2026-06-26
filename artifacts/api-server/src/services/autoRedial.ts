/**
 * Auto-redial service
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared helpers for scheduling no-answer retries and cancelling pending
 * redials when the caller calls back themselves.
 */

import { randomBytes } from "node:crypto";
import { db, scheduledCallbacksTable } from "@workspace/db";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

type CallbackRow = typeof scheduledCallbacksTable.$inferSelect;

/** Generate an unguessable per-row secret for status-callback URL binding. */
function genCallbackSecret(): string {
  return randomBytes(24).toString("hex");
}

/**
 * After a no-answer outbound call fires, check the daily cap and schedule the
 * next retry if we have attempts remaining.
 */
export async function scheduleNextRedial(prev: CallbackRow): Promise<void> {
  if (prev.reason !== "no_answer") return;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(scheduledCallbacksTable)
    .where(and(
      eq(scheduledCallbacksTable.agentId, prev.agentId),
      eq(scheduledCallbacksTable.toNumber, prev.toNumber),
      eq(scheduledCallbacksTable.reason, "no_answer"),
      gte(scheduledCallbacksTable.createdAt, todayStart),
      lt(scheduledCallbacksTable.createdAt, tomorrowStart),
    ));

  const todayCount = row?.count ?? 0;
  const maxAttempts = prev.maxAttempts ?? 5;

  if (todayCount >= maxAttempts) {
    logger.info(
      { agentId: prev.agentId, toNumber: prev.toNumber, todayCount, maxAttempts },
      "Auto-redial: daily cap reached — no retry scheduled",
    );
    return;
  }

  const intervalMs = (prev.redialIntervalMinutes ?? 30) * 60_000;
  const nextAt = new Date(Date.now() + intervalMs);
  const nextAttempt = (prev.attemptCount ?? 1) + 1;

  await db.insert(scheduledCallbacksTable).values({
    agentId:               prev.agentId,
    toNumber:              prev.toNumber,
    userId:                prev.userId,
    scheduledAt:           nextAt,
    createdFromCallId:     prev.createdFromCallId,
    campaignLeadId:        prev.campaignLeadId,
    reason:                "no_answer",
    attemptCount:          nextAttempt,
    maxAttempts:           maxAttempts,
    redialIntervalMinutes: prev.redialIntervalMinutes ?? 30,
    callbackSecret:        genCallbackSecret(),
  });

  logger.info(
    { agentId: prev.agentId, toNumber: prev.toNumber, nextAt, attempt: nextAttempt, todayCount: todayCount + 1, maxAttempts },
    "Auto-redial: next retry scheduled",
  );
}

/**
 * When the caller dials IN to the agent, cancel all pending no-answer redials
 * for that number so we don't bother them again.
 * Returns the number of rows cancelled.
 */
export async function cancelPendingRedials(agentId: number, toNumber: string): Promise<number> {
  const rows = await db
    .update(scheduledCallbacksTable)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(and(
      eq(scheduledCallbacksTable.agentId, agentId),
      eq(scheduledCallbacksTable.toNumber, toNumber),
      eq(scheduledCallbacksTable.status, "pending"),
      eq(scheduledCallbacksTable.reason, "no_answer"),
    ))
    .returning({ id: scheduledCallbacksTable.id });

  if (rows.length > 0) {
    logger.info({ agentId, toNumber, cancelled: rows.length }, "Auto-redial: pending redials cancelled (caller called back)");
  }
  return rows.length;
}

/**
 * Schedule a caller-requested callback.
 * Called from the schedule_callback AI tool handler.
 */
export async function scheduleCallbackRequested(opts: {
  agentId:   number;
  toNumber:  string;
  userId?:   string | null;
  callId?:   number | null;
  scheduledAt: Date;
  notes?:    string | null;
}): Promise<number> {
  const [row] = await db.insert(scheduledCallbacksTable).values({
    agentId:           opts.agentId,
    toNumber:          opts.toNumber,
    userId:            opts.userId ?? null,
    scheduledAt:       opts.scheduledAt,
    createdFromCallId: opts.callId ?? null,
    reason:            "callback_requested",
    maxAttempts:       1,
    notes:             opts.notes ?? null,
    callbackSecret:    genCallbackSecret(),
  }).returning({ id: scheduledCallbacksTable.id });

  logger.info(
    { agentId: opts.agentId, toNumber: opts.toNumber, scheduledAt: opts.scheduledAt },
    "Callback requested: scheduled",
  );
  return row!.id;
}

/**
 * Schedule a no-answer redial for an outbound call that wasn't picked up.
 * Pass maxAttempts and redialIntervalMinutes from agent config (or use defaults).
 */
export async function scheduleNoAnswerRedial(opts: {
  agentId:               number;
  toNumber:              string;
  userId?:               string | null;
  callId?:               number | null;
  maxAttempts?:          number;
  redialIntervalMinutes?: number;
}): Promise<number | null> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const intervalMinutes = opts.redialIntervalMinutes ?? 30;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const [existing] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(scheduledCallbacksTable)
    .where(and(
      eq(scheduledCallbacksTable.agentId, opts.agentId),
      eq(scheduledCallbacksTable.toNumber, opts.toNumber),
      eq(scheduledCallbacksTable.reason, "no_answer"),
      gte(scheduledCallbacksTable.createdAt, todayStart),
      lt(scheduledCallbacksTable.createdAt, tomorrowStart),
    ));

  const todayCount = existing?.count ?? 0;
  if (todayCount >= maxAttempts) {
    logger.info({ agentId: opts.agentId, toNumber: opts.toNumber, todayCount, maxAttempts }, "No-answer: daily cap reached");
    return null;
  }

  const nextAt = new Date(Date.now() + intervalMinutes * 60_000);
  const [row] = await db.insert(scheduledCallbacksTable).values({
    agentId:               opts.agentId,
    toNumber:              opts.toNumber,
    userId:                opts.userId ?? null,
    scheduledAt:           nextAt,
    createdFromCallId:     opts.callId ?? null,
    reason:                "no_answer",
    attemptCount:          todayCount + 1,
    maxAttempts:           maxAttempts,
    redialIntervalMinutes: intervalMinutes,
    callbackSecret:        genCallbackSecret(),
  }).returning({ id: scheduledCallbacksTable.id });

  logger.info(
    { agentId: opts.agentId, toNumber: opts.toNumber, nextAt, attempt: todayCount + 1, maxAttempts },
    "No-answer: redial scheduled",
  );
  return row!.id;
}

import { db, callsTable } from "@workspace/db";
import { and, inArray, isNull, lt, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;    // every hour
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2-hour stale window
// Captured at module initialization, before this process can create a call.
const PROCESS_STARTED_AT = new Date();

let started = false;

/**
 * Auto-recovery: If a call has completed conversation content (call_summary,
 * or meaningful transcript), but got marked as "failed" (e.g. from an aggressive
 * restart sweep while it was still finishing), restore it to "completed" and
 * restore its duration.
 */
async function autoRecoverFalselyFailedCalls(): Promise<void> {
  try {
    const updated = await db.execute(sql`
      UPDATE calls
      SET status = 'completed',
          duration_seconds = GREATEST(1, EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - created_at))::int)
      WHERE status = 'failed'
        AND (call_summary IS NOT NULL OR LENGTH(COALESCE(transcript, '')) > 50)
        AND (duration_seconds IS NULL OR duration_seconds = 0)
      RETURNING id;
    `);
    const rows = (updated as any).rows ?? updated;
    if (rows && rows.length > 0) {
      logger.info(
        { count: rows.length, ids: rows.map((r: any) => r.id) },
        "Auto-recovered falsely failed calls that had valid transcripts/summaries",
      );
    }
  } catch (err) {
    logger.warn({ err }, "Auto-recover falsely failed calls check failed");
  }
}

/**
 * Clears calls that have been "in_progress" for more than 2 hours with no
 * ended_at set.  These are orphaned rows from pre-answer rejections or crashed
 * sessions where neither the status webhook nor endSession() fired correctly.
 */
async function sweepStaleCalls(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
  try {
    const updated = await db
      .update(callsTable)
      .set({
        status: "failed",
        endedAt: new Date(),
        durationSeconds: sql`GREATEST(0, EXTRACT(EPOCH FROM (NOW() - ${callsTable.createdAt})))::int`,
      })
      .where(
        and(
          inArray(callsTable.status, ["ringing", "in_progress"]),
          isNull(callsTable.endedAt),
          lt(callsTable.createdAt, cutoff),
        ),
      )
      .returning({ id: callsTable.id });

    if (updated.length > 0) {
      logger.warn(
        { count: updated.length, ids: updated.map((r) => r.id) },
        "Stale-call sweep: cleared orphaned in_progress calls",
      );
    } else {
      logger.debug("Stale-call sweep: no orphaned calls found");
    }
  } catch (err) {
    logger.warn({ err }, "Stale-call sweep tick failed");
  }
}

/**
 * Startup backstop: runs after boot to catch truly abandoned calls.
 * Uses a 10-minute grace window so rolling restarts don't kill active calls
 * that started on the previous container.
 */
async function sweepOrphanedAtStartup(): Promise<void> {
  // First heal any calls that finished with transcripts/summaries but got marked failed
  await autoRecoverFalselyFailedCalls();

  // Only sweep calls that were created > 10 minutes before this process started.
  const graceCutoff = new Date(PROCESS_STARTED_AT.getTime() - 10 * 60 * 1000);
  try {
    const updated = await db
      .update(callsTable)
      .set({
        status: "failed",
        endedAt: new Date(),
        durationSeconds: sql`GREATEST(0, EXTRACT(EPOCH FROM (NOW() - ${callsTable.createdAt})))::int`,
      })
      .where(
        and(
          inArray(callsTable.status, ["ringing", "in_progress"]),
          isNull(callsTable.endedAt),
          lt(callsTable.createdAt, graceCutoff),
        ),
      )
      .returning({ id: callsTable.id });

    if (updated.length > 0) {
      logger.warn(
        { count: updated.length, ids: updated.map((r) => r.id) },
        "Startup backstop: closed orphaned calls older than grace cutoff from previous server process",
      );
    }
  } catch (err) {
    logger.warn({ err }, "Startup backstop sweep failed");
  }
}

/**
 * Starts the hourly stale-call sweep.  First run is delayed 2 minutes after
 * boot so migrations and warm-up complete before the first DB write.
 * Also fires a one-time startup backstop after 30 seconds to catch calls
 * orphaned by a server restart (in-memory sessions wiped).
 */
export function startStaleCallCleanup(): void {
  if (started) return;
  started = true;

  // Immediately heal any falsely failed calls right at boot time
  void autoRecoverFalselyFailedCalls();

  // One-time startup backstop: every active row predating this process has lost
  // its owning in-memory session and can never close normally.
  setTimeout(() => void sweepOrphanedAtStartup(), 30_000);

  // Periodic long-horizon sweep for calls that somehow never got closed.
  setTimeout(() => {
    void sweepStaleCalls();
    setInterval(() => void sweepStaleCalls(), SWEEP_INTERVAL_MS).unref();
  }, 2 * 60 * 1000);

  logger.info(
    { thresholdHours: 2, intervalHours: 1, processStartedAt: PROCESS_STARTED_AT },
    "Stale-call cleanup sweep scheduled",
  );
}

import { db, callsTable } from "@workspace/db";
import { and, inArray, isNull, lt } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;    // every hour
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2-hour stale window
// Captured at module initialization, before this process can create a call.
// Any active row older than this belongs to a previous process whose in-memory
// session and recording buffer can no longer exist.
const PROCESS_STARTED_AT = new Date();

let started = false;

/**
 * Clears calls that have been "in_progress" for more than 2 hours with no
 * ended_at set.  These are orphaned rows from pre-answer rejections or crashed
 * sessions where neither the status webhook nor endSession() fired correctly.
 *
 * Safe to run frequently: the WHERE clause is guarded by status + ended_at +
 * created_at so it never touches genuinely live calls (which are < 2 hours old)
 * and never touches calls that endSession() already closed (ended_at IS NOT NULL
 * or status ≠ "in_progress").
 */
async function sweepStaleCalls(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
  try {
    const updated = await db
      .update(callsTable)
      .set({ status: "failed", endedAt: new Date() })
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
 * Startup backstop: when the server process restarts, the in-memory `sessions`
 * Map is wiped. Any call that was live on the old process can never have its
 * `endSession()` fire (the session object is gone), so the DB row stays stuck
 * "in_progress" forever. This runs once shortly after boot and closes every
 * active call created before this process started. The old five-minute age
 * threshold missed calls interrupted during their first five minutes — exactly
 * when a deploy is most visible during a customer demo.
 */
async function sweepOrphanedAtStartup(): Promise<void> {
  try {
    const updated = await db
      .update(callsTable)
      .set({ status: "failed", endedAt: new Date() })
      .where(
        and(
          inArray(callsTable.status, ["ringing", "in_progress"]),
          isNull(callsTable.endedAt),
          lt(callsTable.createdAt, PROCESS_STARTED_AT),
        ),
      )
      .returning({ id: callsTable.id });

    if (updated.length > 0) {
      logger.warn(
        { count: updated.length, ids: updated.map((r) => r.id) },
        "Startup backstop: closed orphaned calls from previous server process",
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

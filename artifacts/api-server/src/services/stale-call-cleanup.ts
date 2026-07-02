import { db, callsTable } from "@workspace/db";
import { and, eq, isNull, lt } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;    // every hour
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2-hour stale window

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
          eq(callsTable.status, "in_progress"),
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
 * Starts the hourly stale-call sweep.  First run is delayed 2 minutes after
 * boot so migrations and warm-up complete before the first DB write.
 */
export function startStaleCallCleanup(): void {
  if (started) return;
  started = true;

  setTimeout(() => {
    void sweepStaleCalls();
    setInterval(() => void sweepStaleCalls(), SWEEP_INTERVAL_MS).unref();
  }, 2 * 60 * 1000);

  logger.info(
    { thresholdHours: 2, intervalHours: 1 },
    "Stale-call cleanup sweep scheduled",
  );
}

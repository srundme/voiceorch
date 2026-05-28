import { db, platformSettingsTable } from "@workspace/db";
import { like, inArray } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const RATE_LIMIT_KEY_PREFIX = "test_notif_rate_limit:";
const WINDOW_MS = 60_000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // hourly

async function pruneStaleRateLimitRows(): Promise<void> {
  try {
    const rows = await db
      .select({ key: platformSettingsTable.key, value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(like(platformSettingsTable.key, `${RATE_LIMIT_KEY_PREFIX}%`));

    if (rows.length === 0) return;

    const now = Date.now();
    const staleKeys: string[] = [];

    for (const row of rows) {
      let timestamps: number[] = [];
      try {
        const parsed: unknown = JSON.parse(row.value);
        timestamps = Array.isArray(parsed) ? (parsed as number[]) : [];
      } catch {
        staleKeys.push(row.key);
        continue;
      }
      const active = timestamps.filter((t) => now - t < WINDOW_MS);
      if (active.length === 0) {
        staleKeys.push(row.key);
      }
    }

    if (staleKeys.length === 0) return;

    await db
      .delete(platformSettingsTable)
      .where(inArray(platformSettingsTable.key, staleKeys));

    logger.info({ count: staleKeys.length }, "Pruned stale rate-limit rows from platform_settings");
  } catch (err) {
    logger.warn({ err }, "rate-limit-cleanup: pruning failed");
  }
}

export function startRateLimitCleanup(): void {
  void pruneStaleRateLimitRows();
  const timer = setInterval(() => void pruneStaleRateLimitRows(), CLEANUP_INTERVAL_MS);
  timer.unref();
}

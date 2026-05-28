import { db, platformSettingsTable } from "@workspace/db";
import { like, inArray } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // hourly

/**
 * Describes a class of short-lived `platform_settings` rows that the cleanup
 * service should sweep.  Register new entries with `registerTransientKey`.
 *
 * @param prefix  - Key prefix used to identify rows in `platform_settings`.
 * @param windowMs - How long (ms) a timestamp value is considered "active".
 *                   Rows whose stored timestamps are all older than this window
 *                   (or whose value cannot be parsed) are deleted.
 */
export interface TransientKeyConfig {
  prefix: string;
  windowMs: number;
}

const transientKeyRegistry: TransientKeyConfig[] = [];

/**
 * Register a short-lived `platform_settings` key prefix for automatic cleanup.
 * Call this once at startup for each transient key family your code introduces.
 *
 * Example:
 *   registerTransientKey({ prefix: "my_rate_limit:", windowMs: 60_000 });
 */
export function registerTransientKey(config: TransientKeyConfig): void {
  transientKeyRegistry.push(config);
}

// Built-in: alert-notification rate-limiting (introduced in task #137)
registerTransientKey({ prefix: "test_notif_rate_limit:", windowMs: 60_000 });

async function pruneTransientRows(): Promise<void> {
  if (transientKeyRegistry.length === 0) return;

  const now = Date.now();

  for (const { prefix, windowMs } of transientKeyRegistry) {
    try {
      const rows = await db
        .select({ key: platformSettingsTable.key, value: platformSettingsTable.value })
        .from(platformSettingsTable)
        .where(like(platformSettingsTable.key, `${prefix}%`));

      if (rows.length === 0) continue;

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
        const active = timestamps.filter((t) => now - t < windowMs);
        if (active.length === 0) {
          staleKeys.push(row.key);
        }
      }

      if (staleKeys.length === 0) continue;

      await db
        .delete(platformSettingsTable)
        .where(inArray(platformSettingsTable.key, staleKeys));

      logger.info(
        { prefix, count: staleKeys.length },
        "Pruned stale transient rows from platform_settings",
      );
    } catch (err) {
      logger.warn({ err, prefix }, "rate-limit-cleanup: pruning failed for prefix");
    }
  }
}

export function startRateLimitCleanup(): void {
  void pruneTransientRows();
  const timer = setInterval(() => void pruneTransientRows(), CLEANUP_INTERVAL_MS);
  timer.unref();
}

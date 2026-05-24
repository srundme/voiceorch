import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Acquires a PostgreSQL advisory transaction lock for a given key.
 * The lock is automatically released when the transaction ends.
 * Returns true if the lock was acquired, false if already held by another transaction.
 */
export async function tryAdvisoryLock(lockKey: string): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS acquired`
  );
  const row = result.rows[0] as { acquired: boolean } | undefined;
  return row?.acquired === true;
}

/**
 * Builds a deterministic lock key from a calendar ID and slot start time.
 */
export function buildSlotLockKey(calendarId: number, slotStart: Date): string {
  return `scheduling:${calendarId}:${slotStart.toISOString()}`;
}

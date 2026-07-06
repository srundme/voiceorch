/**
 * Short-TTL cache for a user's account `status` (active/suspended/deleted),
 * keyed by clerkId (Google sub / email:<email> sub).
 *
 * Used by `attachSession` to revoke a deleted/suspended user's session token
 * server-side without waiting for the JWT's 30-day TTL to expire. Without
 * this, an admin "deleting" a user only blocked *new* sign-ins — any bearer
 * token the user already held in localStorage kept working for the rest of
 * its 30-day life.
 *
 * Mirrors the cache pattern in `detectImpersonation.ts`: short TTL bounds the
 * staleness window, and `invalidateUserStatusCache` is called immediately
 * after an admin changes a user's status so the very next request sees it.
 */
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const CACHE_TTL_MS = 5_000;
const cache = new Map<string, { status: string | null; expiresAt: number }>();

/**
 * Returns the user's current `status` column value, or null if no user row
 * exists for this clerkId. Fails OPEN (returns null → treated as "unknown,
 * allow") only on a DB error, matching existing request-path fault tolerance
 * elsewhere in this file's sibling caches; a real outage should not lock out
 * every active user.
 */
export async function getUserStatus(clerkId: string): Promise<string | null> {
  const now = Date.now();
  const cached = cache.get(clerkId);
  if (cached && cached.expiresAt > now) return cached.status;

  try {
    const [row] = await db
      .select({ status: usersTable.status })
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkId))
      .limit(1);

    const status = row?.status ?? null;
    cache.set(clerkId, { status, expiresAt: now + CACHE_TTL_MS });
    return status;
  } catch (err) {
    logger.error({ err, clerkId }, "getUserStatus: DB lookup failed");
    return cache.get(clerkId)?.status ?? null;
  }
}

/** Call immediately after an admin changes a user's status. */
export function invalidateUserStatusCache(clerkId: string): void {
  cache.delete(clerkId);
}

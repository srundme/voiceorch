/**
 * Drop-in replacement for `@clerk/express`'s `getAuth(req)`.
 *
 * After Clerk was removed, the platform session token is verified by the
 * `attachSession` middleware which sets `req.clerkUserId` (the Google account
 * subject id). This shim preserves the `const { userId } = getAuth(req)` call
 * shape used across the route handlers so they keep working unchanged.
 */
import type { Request } from "express";

export function getAuth(req: Request): { userId: string | null } {
  return { userId: (req as unknown as { clerkUserId?: string }).clerkUserId ?? null };
}

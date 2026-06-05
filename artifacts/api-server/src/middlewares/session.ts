/**
 * attachSession — validate the platform session token (if present) and populate
 * the request with the authenticated identity.
 *
 * Runs globally (app-level) before rate limiting and routing so:
 *   - the auth-based rate limiter can key on the user id
 *   - `requireAuth` / `getAuth(req)` see `req.clerkUserId`
 *   - `provisionUser` can read the decoded payload (`req.sessionPayload`)
 *
 * Accepts the token via `Authorization: Bearer <jwt>` or `?token=<jwt>` (the
 * latter for EventSource, which cannot set custom headers). Never rejects — it
 * only annotates the request; enforcement is left to `requireAuth`.
 */
import type { Request, Response, NextFunction } from "express";
import { extractRequestToken, verifySessionToken, type SessionPayload } from "../lib/session.js";

export function attachSession(req: Request, _res: Response, next: NextFunction): void {
  const token = extractRequestToken(req);
  const payload = token ? verifySessionToken(token) : null;
  if (payload) {
    (req as unknown as { sessionPayload: SessionPayload }).sessionPayload = payload;
    (req as unknown as { clerkUserId: string }).clerkUserId = payload.sub;
  }
  next();
}

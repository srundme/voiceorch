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
 *
 * Impersonation tokens carry an `imp` claim (the opaque session token stored in
 * admin_impersonation_sessions). For these tokens we do a fast DB/cache check to
 * confirm the session is still active before granting identity. This makes
 * impersonation JWTs server-side revocable: when an admin ends a session, any
 * retained bearer token is denied within the cache TTL (≤ 5 s).
 */
import type { Request, Response, NextFunction } from "express";
import { extractRequestToken, verifySessionToken, type SessionPayload } from "../lib/session.js";
import { isImpersonationSessionActive } from "./detectImpersonation.js";
import { getUserStatus } from "./userStatusCache.js";

export async function attachSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extractRequestToken(req);
  const payload = token ? verifySessionToken(token) : null;
  if (payload) {
    if (payload.imp) {
      const active = await isImpersonationSessionActive(payload.imp);
      if (!active) {
        next();
        return;
      }
    } else {
      // Non-impersonation tokens are long-lived (30-day TTL) and self-contained,
      // so a status change (admin soft-delete/suspend) would otherwise have no
      // effect on an already-issued bearer token until it expires. Deny identity
      // (fail closed) for any account that is not "active".
      const status = await getUserStatus(payload.sub);
      if (status !== null && status !== "active") {
        next();
        return;
      }
    }
    (req as unknown as { sessionPayload: SessionPayload }).sessionPayload = payload;
    (req as unknown as { clerkUserId: string }).clerkUserId = payload.sub;
  }
  next();
}

/**
 * Reject authenticated sessions on partner white-label hosts when the signed-in
 * user is not that partner's owner or managed client.
 */
import type { Request, Response, NextFunction } from "express";
import { clearSessionCookie } from "../lib/session-cookie.js";
import {
  assertLoginHostAllowed,
  resolvePartnerHostFromRequest,
} from "../lib/partner-portal-access.js";

const PUBLIC_PREFIXES = [
  "/api/public/",
  "/api/widget",
  "/api/webhooks/",
  "/api/healthz",
];

const PRE_AUTH_PREFIXES = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/password-reset/request",
  "/api/auth/google/",
];

function pathMatches(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p.replace(/\/$/, "") || path.startsWith(p));
}

export async function enforcePartnerPortalAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const path = req.path;
    if (pathMatches(path, PUBLIC_PREFIXES) || pathMatches(path, PRE_AUTH_PREFIXES)) {
      next();
      return;
    }

    const clerkId = (req as unknown as { clerkUserId?: string }).clerkUserId;
    if (!clerkId) {
      next();
      return;
    }

    const bodyHost =
      typeof (req.body as { host?: unknown })?.host === "string"
        ? (req.body as { host: string }).host
        : undefined;
    const partnerBrand = await resolvePartnerHostFromRequest(req, bodyHost);
    const gate = await assertLoginHostAllowed(clerkId, partnerBrand);
    if (gate.ok) {
      next();
      return;
    }

    clearSessionCookie(res);
    res.status(403).json({ error: gate.error });
  } catch (err) {
    req.log.error({ err }, "partner portal access check failed");
    res.status(500).json({ error: "Internal server error" });
  }
}

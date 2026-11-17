// ── Agent edit access ────────────────────────────────────────────────────────
// Only accounts an admin has granted (users.agent_edit_allowed) may create,
// edit, delete or test-call agents. Everyone else — including partners and
// partner clients — can view their agents but not change or test them.
//
// Admins impersonating a user (Admin Mode) are always allowed through.

import type { NextFunction, Request, Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

export const AGENT_EDIT_RESTRICTED_CODE = "AGENT_EDIT_RESTRICTED";
export const AGENT_EDIT_RESTRICTED_MESSAGE =
  "Due to a technical issue, creating, editing and test-calling agents is temporarily restricted. We are working on it.";

const CACHE_TTL_MS = 5_000;
const cache = new Map<string, { allowed: boolean; expiresAt: number }>();

/** True when this account may create/edit/test agents. Fails closed on a DB error. */
export async function isAgentEditAllowed(clerkId: string): Promise<boolean> {
  const now = Date.now();
  const hit = cache.get(clerkId);
  if (hit && hit.expiresAt > now) return hit.allowed;
  try {
    const [row] = await db
      .select({ allowed: usersTable.agentEditAllowed })
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkId))
      .limit(1);
    const allowed = row?.allowed === true;
    cache.set(clerkId, { allowed, expiresAt: now + CACHE_TTL_MS });
    return allowed;
  } catch (err) {
    logger.error({ err, clerkId }, "isAgentEditAllowed: DB lookup failed");
    return hit?.allowed ?? false;
  }
}

export function invalidateAgentEditAccess(clerkId: string): void {
  cache.delete(clerkId);
}

export function isImpersonatedRequest(req: Request): boolean {
  return !!(req as unknown as { impersonationSession?: unknown }).impersonationSession;
}

/**
 * Route guard: 403 AGENT_EDIT_RESTRICTED unless the effective account (after
 * clientContext) has agent edit access. A partner acting for a client must
 * have access themselves too.
 */
export function requireAgentEditAccess(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    if (isImpersonatedRequest(req)) { next(); return; }
    const r = req as unknown as { clerkUserId?: string; actingPartnerClerkId?: string };
    if (!r.clerkUserId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const ids = [r.clerkUserId, ...(r.actingPartnerClerkId ? [r.actingPartnerClerkId] : [])];
    for (const id of ids) {
      if (!(await isAgentEditAllowed(id))) {
        res.status(403).json({ error: AGENT_EDIT_RESTRICTED_MESSAGE, code: AGENT_EDIT_RESTRICTED_CODE });
        return;
      }
    }
    next();
  })().catch((err) => {
    req.log?.error({ err }, "requireAgentEditAccess failed");
    res.status(500).json({ error: "Internal server error" });
  });
}

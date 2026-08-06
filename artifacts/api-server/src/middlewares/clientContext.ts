import type { Request, Response, NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { db, usersTable, partnersTable } from "@workspace/db";

/**
 * Managed-client mode (partner acting on behalf of a client).
 *
 * Two cooperating middlewares:
 *
 * 1. `clientContext` — honours the `x-client-context: <client clerkId>` header.
 *    When present, the requester must be an ACTIVE partner that manages that
 *    client (users.partnerId → partners row). On success the request's
 *    effective identity (`req.clerkUserId`) is swapped to the client, so every
 *    downstream handler operates on the client's account exactly as if the
 *    client made the call. `req.actingPartnerClerkId` records who really did.
 *
 * 2. `denyManagedClient` — blocks WRITE endpoints for managed clients acting
 *    on their own (their workspace is partner-managed). Partners acting via
 *    `clientContext` pass through. Responds 403 with code MANAGED_BY_PARTNER.
 *
 * 3. `denyManagedClientUnlessAgentEdit` — same, but allows through when the
 *    partner turned on `users.partnerAllowAgentEdit` for this client (agent
 *    create/edit/save + related agent tooling only).
 *
 * Order matters: `requireAuth, clientContext, denyManagedClient, handler`.
 */

export const CLIENT_CONTEXT_HEADER = "x-client-context";

export interface ManagingPartner {
  partnerId: number;
  /** Clerk id of the partner's own user account. */
  partnerUserId: string;
  companyName: string;
  /** Partner granted this client permission to edit/save agents. */
  allowAgentEdit: boolean;
}

/** The ACTIVE partner managing this client, or null when unmanaged. */
export async function getManagingPartner(clientClerkId: string): Promise<ManagingPartner | null> {
  const [row] = await db
    .select({
      partnerId: partnersTable.id,
      partnerUserId: partnersTable.userId,
      companyName: partnersTable.companyName,
      allowAgentEdit: usersTable.partnerAllowAgentEdit,
    })
    .from(usersTable)
    .innerJoin(partnersTable, eq(usersTable.partnerId, partnersTable.id))
    .where(and(eq(usersTable.clerkId, clientClerkId), eq(partnersTable.status, "active")));
  return row ?? null;
}

export function clientContext(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    const raw = req.headers[CLIENT_CONTEXT_HEADER];
    const targetClientId = typeof raw === "string" ? raw.trim() : "";
    if (!targetClientId) {
      next();
      return;
    }

    const requesterId = (req as unknown as { clerkUserId?: string }).clerkUserId;
    if (!requesterId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    // Self-reference is a no-op (defensive; the dashboard never sends it).
    if (targetClientId === requesterId) {
      next();
      return;
    }

    // Requester must be an ACTIVE partner that manages the target client.
    const [link] = await db
      .select({ clientClerkId: usersTable.clerkId })
      .from(usersTable)
      .innerJoin(partnersTable, eq(usersTable.partnerId, partnersTable.id))
      .where(and(
        eq(usersTable.clerkId, targetClientId),
        eq(partnersTable.userId, requesterId),
        eq(partnersTable.status, "active"),
      ));
    if (!link) {
      res.status(403).json({ error: "You do not manage this client account" });
      return;
    }

    (req as unknown as { actingPartnerClerkId?: string }).actingPartnerClerkId = requesterId;
    (req as unknown as { clerkUserId?: string }).clerkUserId = targetClientId;
    next();
  })().catch((err) => {
    req.log?.error({ err }, "clientContext middleware failed");
    res.status(500).json({ error: "Internal server error" });
  });
}

function runDenyManagedClient(
  req: Request,
  res: Response,
  next: NextFunction,
  opts: { allowAgentEdit?: boolean },
): void {
  void (async () => {
    // A partner acting for their client is always allowed through.
    if ((req as unknown as { actingPartnerClerkId?: string }).actingPartnerClerkId) {
      next();
      return;
    }
    const clerkId = (req as unknown as { clerkUserId?: string }).clerkUserId;
    if (!clerkId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const partner = await getManagingPartner(clerkId);
    // Self-partner guard: a partner whose own user row links to their own org
    // is the org OWNER, not a managed client — never block them.
    if (partner && partner.partnerUserId !== clerkId) {
      if (opts.allowAgentEdit && partner.allowAgentEdit) {
        next();
        return;
      }
      res.status(403).json({
        error: `This workspace is managed by ${partner.companyName}. Ask them to make this change for you.`,
        code: "MANAGED_BY_PARTNER",
      });
      return;
    }
    next();
  })().catch((err) => {
    req.log?.error({ err }, "denyManagedClient middleware failed");
    res.status(500).json({ error: "Internal server error" });
  });
}

/** Block all managed-client writes (phones, billing-sensitive ops, etc.). */
export function denyManagedClient(req: Request, res: Response, next: NextFunction): void {
  runDenyManagedClient(req, res, next, {});
}

/**
 * Block managed-client writes unless the partner enabled agent editing for
 * this client. Use on agent create/edit/save and closely related routes.
 */
export function denyManagedClientUnlessAgentEdit(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  runDenyManagedClient(req, res, next, { allowAgentEdit: true });
}

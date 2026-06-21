import type { Request, Response, NextFunction } from "express";
import { db, adminImpersonationSessionsTable, adminAuditLogsTable } from "@workspace/db";
import { eq, and, isNull, gt } from "drizzle-orm";
import { logger } from "../lib/logger.js";

interface ImpersonationSession {
  sessionToken: string;
  adminId: string;
  targetUserId: string;
}

// Cache by (clerkUserId → session | null), 5 s TTL.
// Invalidated immediately on session end via invalidateImpersonationCache().
// 5 s (down from 30 s) narrows the window for stale "active" sessions on
// replicas that didn't receive the invalidation call when a session ends.
const cache = new Map<string, { session: ImpersonationSession | null; expiresAt: number }>();
const CACHE_TTL_MS = 5_000;

async function lookupImpersonationSession(clerkUserId: string): Promise<ImpersonationSession | null> {
  const now = Date.now();
  const cached = cache.get(clerkUserId);
  if (cached && cached.expiresAt > now) return cached.session;

  try {
    const [row] = await db
      .select()
      .from(adminImpersonationSessionsTable)
      .where(
        and(
          eq(adminImpersonationSessionsTable.targetUserId, clerkUserId),
          isNull(adminImpersonationSessionsTable.endedAt),
          gt(adminImpersonationSessionsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);

    const session = row
      ? { sessionToken: row.sessionToken, adminId: row.adminId, targetUserId: row.targetUserId }
      : null;
    cache.set(clerkUserId, { session, expiresAt: now + CACHE_TTL_MS });
    return session;
  } catch (err) {
    logger.error({ err }, "detectImpersonation: DB lookup failed");
    return null;
  }
}

/**
 * Call this immediately after ending an impersonation session so the in-process
 * cache doesn't keep attributing subsequent requests for up to 30 s.
 */
export function invalidateImpersonationCache(clerkUserId: string): void {
  cache.delete(clerkUserId);
}

// Known route segment → stable resource type mapping.
// Listed segments that look like resource collections/controllers.
const RESOURCE_SEGMENT_MAP: Record<string, string> = {
  agents: "agent",
  calls: "call",
  providers: "provider",
  bookings: "booking",
  campaigns: "campaign",
  leads: "lead",
  wallet: "wallet",
  webhooks: "webhook",
  templates: "template",
  "event-types": "event_type",
  calendars: "calendar",
  transfers: "call_transfer",
  knowledge: "knowledge",
  dispositions: "disposition",
  simulations: "simulation",
  users: "user",
};

/**
 * Extract a resource type from a URL path by mapping the last meaningful
 * path segment against known resource names. Falls back to the last non-id segment.
 */
function extractResourceType(path: string): string {
  const segments = path.split("/").filter(Boolean);
  // Walk segments in reverse; skip IDs (numeric or UUID/Clerk-style strings after the resource)
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!;
    if (RESOURCE_SEGMENT_MAP[seg]) return RESOURCE_SEGMENT_MAP[seg]!;
    // If not a known resource but also not an ID (pure numeric / UUID / base64-looking),
    // use it as-is (e.g. 'credit', 'toggle', 'status')
    if (!/^[0-9a-f-]{8,}$|^\d+$/.test(seg)) return seg;
  }
  return "resource";
}

/**
 * Extract a resource ID from a URL path. Captures:
 * - Numeric IDs (e.g. /agents/42)
 * - UUID / Clerk-style IDs (hex strings with or without hyphens)
 */
function extractResourceId(path: string): string | null {
  const segments = path.split("/").filter(Boolean);
  // Walk in reverse to find the most-specific ID
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!;
    // Numeric ID
    if (/^\d+$/.test(seg)) return seg;
    // UUID (8-4-4-4-12 hex)
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return seg;
    // Clerk-style IDs: user_xxx, org_xxx, etc.
    if (/^[a-z]+_[a-zA-Z0-9]{16,}$/.test(seg)) return seg;
  }
  return null;
}

export async function detectImpersonation(req: Request, res: Response, next: NextFunction): Promise<void> {
  const clerkUserId = (req as unknown as { clerkUserId?: string }).clerkUserId;
  if (!clerkUserId) { next(); return; }

  const session = await lookupImpersonationSession(clerkUserId);

  logger.debug(
    {
      adminId: session?.adminId ?? null,
      effectiveUserId: clerkUserId,
      impersonated: !!session,
      route: req.path,
      method: req.method,
    },
    "[impersonation] identity resolved",
  );

  if (session) {
    (req as unknown as { impersonationSession: ImpersonationSession }).impersonationSession = session;

    res.on("finish", () => {
      if (req.method === "GET" || res.statusCode >= 400) return;
      const ip = (req.headers["x-forwarded-for"] as string | undefined) ?? req.ip ?? null;
      const resourceType = extractResourceType(req.path);
      const resourceId = extractResourceId(req.path);
      db.insert(adminAuditLogsTable)
        .values({
          adminId: session.adminId,
          targetUserId: session.targetUserId,
          targetResourceType: resourceType,
          targetResourceId: resourceId,
          action: `impersonated:${req.method}:${req.path}`,
          beforeValue: null,
          afterValue: {
            method: req.method,
            path: req.path,
            status: res.statusCode,
          },
          ipAddress: ip,
          userAgent: req.headers["user-agent"] ?? null,
        })
        .catch((err: unknown) => logger.error({ err }, "detectImpersonation: audit insert failed"));
    });
  }

  next();
}

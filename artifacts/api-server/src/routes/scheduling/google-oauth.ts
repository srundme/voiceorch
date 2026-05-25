import { Router, type IRouter } from "express";
import { requireAuth } from "../../middlewares/requireAuth.js";
import {
  getAuthUrl,
  exchangeCode,
  upsertConnection,
  listConnectionsForUser,
  revokeConnection,
} from "../../services/scheduling/google-calendar.js";
import { logger } from "../../lib/logger.js";

const router: IRouter = Router();

const DASHBOARD_BASE = () => {
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  return domain ? `https://${domain}` : "http://localhost:80";
};

// ── List connected Google accounts ───────────────────────────────────────────

router.get("/scheduling/google/connections", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const connections = await listConnectionsForUser(clerkId);
  res.json(connections.map(c => ({
    id: c.id,
    email: c.email,
    connectedAt: c.createdAt,
  })));
});

// ── OAuth connect — redirect to Google consent screen ───────────────────────

router.get("/scheduling/google/connect", requireAuth, (req, res): void => {
  const clerkId  = (req as any).clerkUserId as string;
  const returnTo = (req.query["returnTo"] as string | undefined) ?? "conferencing";

  if (!process.env["GOOGLE_CLIENT_ID"] || !process.env["GOOGLE_CLIENT_SECRET"]) {
    res.status(503).json({ error: "Google OAuth not configured on this platform." });
    return;
  }

  const url = getAuthUrl(clerkId, returnTo);
  res.redirect(url);
});

// ── OAuth callback — no requireAuth: Google redirects here ──────────────────
// State is JSON { clerkId, returnTo } — tells us who connected and where to redirect.

router.get("/scheduling/google/callback", async (req, res): Promise<void> => {
  const { code, error, state: rawState } = req.query as {
    code?: string; error?: string; state?: string;
  };

  // Decode state — support both legacy string (plain clerkId) and new JSON format
  let clerkId: string | undefined;
  let returnTo = "conferencing";
  if (rawState) {
    try {
      const parsed = JSON.parse(rawState) as { clerkId?: string; returnTo?: string };
      clerkId  = parsed.clerkId;
      returnTo = parsed.returnTo ?? "conferencing";
    } catch {
      // Legacy: state was just the clerkId string
      clerkId = rawState;
    }
  }

  const settingsPath = returnTo === "calendar" ? "calendar" : "conferencing";
  const redirectBase = `${DASHBOARD_BASE()}/app/settings/${settingsPath}`;

  if (error || !code || !clerkId) {
    logger.warn({ clerkId, error }, "Google OAuth callback error or missing params");
    res.redirect(`${redirectBase}?gcal=error`);
    return;
  }

  try {
    const tokens = await exchangeCode(code);
    await upsertConnection(
      clerkId,
      tokens.email,
      tokens.accessToken,
      tokens.refreshToken,
      tokens.expiry,
    );
    logger.info({ clerkId, email: tokens.email }, "Google Calendar connected");
    res.redirect(`${redirectBase}?gcal=connected&email=${encodeURIComponent(tokens.email)}`);
  } catch (err) {
    logger.warn({ err, clerkId }, "Failed to exchange Google OAuth code");
    res.redirect(`${redirectBase}?gcal=error`);
  }
});

// ── Disconnect a specific Google account ─────────────────────────────────────

router.delete("/scheduling/google/connections/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId      = (req as any).clerkUserId as string;
  const connectionId = req.params["id"] as string;

  // Security: verify this connection belongs to the authenticated user
  const connections = await listConnectionsForUser(clerkId);
  const owns = connections.some(c => c.id === connectionId);
  if (!owns) {
    res.status(403).json({ error: "Not authorized to disconnect this account" });
    return;
  }

  await revokeConnection(connectionId);
  logger.info({ clerkId, connectionId }, "Google Calendar disconnected");
  res.sendStatus(204);
});

// ── Calendar→connection mapping (which account is linked to which calendar) ──

router.get("/scheduling/google/calendar-links", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const { db } = await import("@workspace/db");
  const { sql } = await import("drizzle-orm");
  const rows = await db.execute(
    sql`SELECT id, google_calendar_connection_id FROM scheduling_calendars WHERE user_id = ${clerkId}`
  );
  const map: Record<number, string | null> = {};
  for (const r of rows.rows as any[]) {
    map[r.id] = r.google_calendar_connection_id ?? null;
  }
  res.json(map);
});

// ── Status (legacy single-account compat) ────────────────────────────────────

router.get("/scheduling/google/status", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const connections = await listConnectionsForUser(clerkId);
  res.json({
    connected: connections.length > 0,
    connections: connections.map(c => ({ id: c.id, email: c.email })),
    // Legacy compat
    email: connections[0]?.email ?? null,
    credentialsConfigured: true, // platform-level — always true
  });
});

export default router;

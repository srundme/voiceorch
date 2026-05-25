import { Router, type IRouter } from "express";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  getAuthUrl,
  exchangeCode,
  storeTokens,
  revokeTokens,
  getOAuthConfig,
  saveOAuthConfig,
  deleteOAuthConfig,
} from "../../services/scheduling/google-calendar.js";
import { logger } from "../../lib/logger.js";

const router: IRouter = Router();

const DASHBOARD_BASE = () => {
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  return domain ? `https://${domain}` : "http://localhost:80";
};

// ── Credential management (per-user client_id + client_secret) ───────────────

router.get("/scheduling/google/credentials", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const config = await getOAuthConfig(clerkId);
  if (!config) {
    res.json({ configured: false, clientIdHint: null });
    return;
  }
  const hint = config.clientId.length > 8
    ? `${config.clientId.slice(0, 8)}...${config.clientId.slice(-4)}`
    : config.clientId;
  res.json({ configured: true, clientIdHint: hint });
});

router.put("/scheduling/google/credentials", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const { clientId, clientSecret } = req.body as { clientId?: string; clientSecret?: string };
  if (!clientId?.trim() || !clientSecret?.trim()) {
    res.status(400).json({ error: "clientId and clientSecret are required" });
    return;
  }
  await saveOAuthConfig(clerkId, clientId.trim(), clientSecret.trim());
  logger.info({ clerkId }, "Google OAuth credentials saved");
  res.json({ ok: true });
});

router.delete("/scheduling/google/credentials", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  await deleteOAuthConfig(clerkId);
  res.sendStatus(204);
});

// ── OAuth connect / callback ─────────────────────────────────────────────────

router.get("/scheduling/google/connect", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const config = await getOAuthConfig(clerkId);
  if (!config) {
    res.status(400).json({ error: "Google OAuth credentials not configured. Please save your client_id and client_secret first." });
    return;
  }
  const url = getAuthUrl(config.clientId, config.clientSecret, clerkId);
  res.redirect(url);
});

// Callback — no requireAuth: Google redirects here from outside, session cookie
// may not be present. We identify the user via the `state` param (clerkId).
router.get("/scheduling/google/callback", async (req, res): Promise<void> => {
  const { code, error, state: clerkId } = req.query as { code?: string; error?: string; state?: string };
  const redirectBase = `${DASHBOARD_BASE()}/app/settings/conferencing`;

  if (error || !code || !clerkId) {
    logger.warn({ clerkId, error }, "Google OAuth callback error");
    res.redirect(`${redirectBase}?gcal=error`);
    return;
  }

  const config = await getOAuthConfig(clerkId);
  if (!config) {
    logger.warn({ clerkId }, "Google OAuth callback — no credentials stored for user");
    res.redirect(`${redirectBase}?gcal=error`);
    return;
  }

  try {
    const tokens = await exchangeCode(config.clientId, config.clientSecret, code);
    await storeTokens(clerkId, tokens.accessToken, tokens.refreshToken, tokens.expiry, tokens.email);
    logger.info({ clerkId, email: tokens.email }, "Google Calendar connected");
    res.redirect(`${redirectBase}?gcal=connected`);
  } catch (err) {
    logger.warn({ err, clerkId }, "Failed to exchange Google OAuth code");
    res.redirect(`${redirectBase}?gcal=error`);
  }
});

// ── Connection status / disconnect ───────────────────────────────────────────

router.get("/scheduling/google/status", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const rows = await db.execute(
    sql`SELECT email FROM google_calendar_tokens WHERE user_id = ${clerkId}`,
  );
  const row = rows.rows[0] as any;
  const config = await getOAuthConfig(clerkId);
  res.json({
    connected: !!row,
    email: row?.email ?? null,
    credentialsConfigured: !!config,
  });
});

router.delete("/scheduling/google/disconnect", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  await revokeTokens(clerkId);
  res.sendStatus(204);
});

export default router;

import { Router, type IRouter } from "express";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  getAuthUrl,
  exchangeCode,
  storeTokens,
  revokeTokens,
} from "../../services/scheduling/google-calendar.js";
import { logger } from "../../lib/logger.js";

const router: IRouter = Router();

const DASHBOARD_BASE = () => {
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  return domain ? `https://${domain}` : "http://localhost:80";
};

router.get("/scheduling/google/connect", requireAuth, (req, res): void => {
  const clerkId = (req as any).clerkUserId as string;
  const url = getAuthUrl(clerkId);
  res.redirect(url);
});

router.get("/scheduling/google/callback", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const { code, error } = req.query as { code?: string; error?: string };

  const redirectBase = `${DASHBOARD_BASE()}/app/settings/conferencing`;

  if (error || !code) {
    logger.warn({ clerkId, error }, "Google OAuth callback error");
    res.redirect(`${redirectBase}?gcal=error`);
    return;
  }

  try {
    const tokens = await exchangeCode(code);
    await storeTokens(clerkId, tokens.accessToken, tokens.refreshToken, tokens.expiry, tokens.email);
    logger.info({ clerkId, email: tokens.email }, "Google Calendar connected");
    res.redirect(`${redirectBase}?gcal=connected`);
  } catch (err) {
    logger.warn({ err, clerkId }, "Failed to exchange Google OAuth code");
    res.redirect(`${redirectBase}?gcal=error`);
  }
});

router.get("/scheduling/google/status", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const rows = await db.execute(
    sql`SELECT email FROM google_calendar_tokens WHERE user_id = ${clerkId}`,
  );
  const row = rows.rows[0] as any;
  if (row) {
    res.json({ connected: true, email: row.email });
  } else {
    res.json({ connected: false, email: null });
  }
});

router.delete("/scheduling/google/disconnect", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  await revokeTokens(clerkId);
  res.sendStatus(204);
});

export default router;

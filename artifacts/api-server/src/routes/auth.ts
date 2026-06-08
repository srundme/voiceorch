/**
 * Standalone Google login routes.
 *
 *   GET /api/auth/google/connect  — redirect to the Google consent screen
 *   GET /api/auth/google/callback — exchange the code, issue a platform session
 *                                   token, and bounce back to the dashboard
 *
 * No Clerk involved. The session token is delivered to the SPA in the URL
 * fragment (#session=<jwt>) so it never appears in server logs or the Referer
 * header; the frontend captures it on load and stores it in localStorage.
 */
import { Router, type IRouter } from "express";
import { getLoginAuthUrl, exchangeLoginCode } from "../services/auth/google-login.js";
import { createSessionToken } from "../lib/session.js";
import { isTrustedOrigin, dashboardBase, deriveRedirectUri } from "../lib/oauth-redirect.js";
import { logger } from "../lib/logger.js";
import * as agnost from "agnostai";

const router: IRouter = Router();

const CALLBACK_PATH = "/api/auth/google/callback";

// ── Redirect to Google consent ───────────────────────────────────────────────

router.get("/auth/google/connect", (req, res): void => {
  if (!process.env["GOOGLE_CLIENT_ID"] || !process.env["GOOGLE_CLIENT_SECRET"]) {
    res.status(503).json({ error: "Google login is not configured on this platform." });
    return;
  }

  const returnOrigin = req.query["returnOrigin"] as string | undefined;
  const redirectUri = deriveRedirectUri(req, CALLBACK_PATH);
  const state = JSON.stringify(
    returnOrigin && isTrustedOrigin(returnOrigin) ? { returnOrigin } : {},
  );
  res.redirect(getLoginAuthUrl(state, redirectUri));
});

// ── OAuth callback — issues the platform session token ──────────────────────

router.get("/auth/google/callback", async (req, res): Promise<void> => {
  const { code, error, state: rawState } = req.query as {
    code?: string;
    error?: string;
    state?: string;
  };

  let returnOrigin: string | undefined;
  if (rawState) {
    try {
      const parsed = JSON.parse(rawState) as { returnOrigin?: string };
      returnOrigin = parsed.returnOrigin;
    } catch {
      /* ignore malformed state */
    }
  }
  const base = returnOrigin && isTrustedOrigin(returnOrigin) ? returnOrigin : dashboardBase();

  if (error || !code) {
    logger.warn({ error }, "Google login callback error or missing code");
    res.redirect(`${base}/sign-in?auth_error=1`);
    return;
  }

  try {
    const redirectUri = deriveRedirectUri(req, CALLBACK_PATH);
    const profile = await exchangeLoginCode(code, redirectUri);
    const token = createSessionToken({
      sub: profile.sub,
      email: profile.email,
      name: profile.name,
    });
    agnost.identify(profile.sub, {
      email: profile.email ?? "",
      name: profile.name ?? "",
    });
    logger.info({ sub: profile.sub, email: profile.email }, "User signed in via Google");
    res.redirect(`${base}/app#session=${encodeURIComponent(token)}`);
  } catch (err) {
    logger.warn({ err }, "Failed to exchange Google login code");
    res.redirect(`${base}/sign-in?auth_error=1`);
  }
});

export default router;

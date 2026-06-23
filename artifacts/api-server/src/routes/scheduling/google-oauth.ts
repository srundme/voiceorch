import { Router, type IRouter, type Request } from "express";
import { requireAuth } from "../../middlewares/requireAuth.js";
import {
  getAuthUrl,
  exchangeCode,
  upsertConnection,
  listConnectionsForUser,
  revokeConnection,
  listConnectionCalendars,
  getValidAccessToken,
} from "../../services/scheduling/google-calendar.js";
import { logger } from "../../lib/logger.js";
import { getAppDomain, getAppOrigins, getSelfBaseUrl } from "../../lib/app-domain.js";

const router: IRouter = Router();

const DASHBOARD_BASE = () => {
  if (process.env["APP_BASE_URL"]) {
    return process.env["APP_BASE_URL"].replace(/\/$/, "");
  }
  return getSelfBaseUrl();
};

/**
 * Allow the callback to redirect back to the origin that initiated the flow.
 * Accepts:
 *   - The explicit APP_BASE_URL origin (e.g. https://app.snapserve.ai)
 *   - Any origin listed in REPLIT_DOMAINS (production + dev previews registered there)
 *   - Any *.sisko.replit.dev or *.replit.dev Replit workspace domain (dev previews)
 * Rejects anything else to prevent open-redirect abuse.
 */
function isTrustedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
    const host = url.hostname;
    if (process.env["APP_BASE_URL"]) {
      try {
        const appUrl = new URL(process.env["APP_BASE_URL"]);
        if (appUrl.hostname === host) return true;
      } catch {
        // ignore malformed APP_BASE_URL
      }
    }
    const trustedHosts = getAppOrigins().map((o) => {
      try { return new URL(o).hostname; } catch { return ""; }
    }).filter(Boolean);
    if (trustedHosts.includes(host)) return true;
    if (/^[a-z0-9-]+-\d{2}-[a-z0-9]+\.sisko\.replit\.dev$/.test(host)) return true;
    if (/^[a-z0-9-]+\.replit\.dev$/.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Derive the OAuth redirect URI for the Google Calendar OAuth flow.
 *
 * Derivation order (highest priority first):
 *   1. GOOGLE_REDIRECT_URI env var — must match what is registered in Google
 *      Cloud Console exactly. Always use this in production.
 *   2. Request's forwarded host (externally-visible dev/prod domain) —
 *      used as a convenience fallback in development when no env var is set.
 *   3. First domain in REPLIT_DOMAINS
 *   4. localhost:80 (last resort, never reaches Google in practice)
 *
 * The dynamic forwarded-host derivation is a fallback only. In production
 * the env var must be set so Google gets the exact registered URI.
 */
function deriveRedirectUri(req: Request): string {
  // Env-var override is always first — ensures exact match with the URI
  // registered in Google Cloud Console regardless of which host header
  // the proxy injects.
  if (process.env["GOOGLE_REDIRECT_URI"]) {
    return process.env["GOOGLE_REDIRECT_URI"];
  }

  // Dynamic derivation from the forwarded host (useful in development where
  // the preview domain changes and a fixed URI hasn't been registered).
  const forwardedHost  = (req.headers["x-forwarded-host"]  as string | undefined)?.split(",")[0]?.trim();
  const forwardedProto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? "https";
  const host = forwardedHost ?? req.hostname;

  if (host && isTrustedOrigin(`${forwardedProto}://${host}`)) {
    return `${forwardedProto}://${host}/api/scheduling/google/callback`;
  }

  return `${getSelfBaseUrl()}/api/scheduling/google/callback`;
}

// ── List connected Google accounts ───────────────────────────────────────────

router.get("/scheduling/google/connections", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const connections = await listConnectionsForUser(clerkId);
  res.json(connections.map(c => {
    // Only the full calendar scope supports conferenceDataVersion=1 (Meet links).
    // calendar.events is insufficient, and legacy NULL connections predate scope capture
    // so they are treated as scope-insufficient to prompt the user to reconnect.
    const scopeValid = !!(c.grantedScopes && c.grantedScopes.split(/\s+/).includes("https://www.googleapis.com/auth/calendar"));
    return {
      id: c.id,
      email: c.email,
      connectedAt: c.createdAt,
      grantedScopes: c.grantedScopes ?? null,
      scopeValid,
    };
  }));
});

// ── OAuth connect — redirect to Google consent screen ───────────────────────

router.get("/scheduling/google/connect", requireAuth, (req, res): void => {
  const clerkId      = (req as any).clerkUserId as string;
  const returnTo     = (req.query["returnTo"] as string | undefined) ?? "conferencing";
  const returnOrigin = req.query["returnOrigin"] as string | undefined;

  if (!process.env["GOOGLE_CLIENT_ID"] || !process.env["GOOGLE_CLIENT_SECRET"]) {
    res.status(503).json({ error: "Google OAuth not configured on this platform." });
    return;
  }

  const redirectUri = deriveRedirectUri(req);
  const url = getAuthUrl(
    clerkId,
    returnTo,
    returnOrigin && isTrustedOrigin(returnOrigin) ? returnOrigin : undefined,
    redirectUri,
  );
  res.redirect(url);
});

// ── OAuth connect URL — returns the Google auth URL as JSON (for Bearer-token callers) ─

router.get("/scheduling/google/connect-url", requireAuth, async (req, res): Promise<void> => {
  const clerkId      = (req as any).clerkUserId as string;
  const returnTo     = (req.query["returnTo"] as string | undefined) ?? "conferencing";
  const returnOrigin = req.query["returnOrigin"] as string | undefined;
  const connectionId = req.query["connection_id"] as string | undefined;

  if (!process.env["GOOGLE_CLIENT_ID"] || !process.env["GOOGLE_CLIENT_SECRET"]) {
    res.status(503).json({ error: "Google OAuth not configured on this platform." });
    return;
  }

  // If a connection_id is supplied (re-auth flow), verify ownership before embedding
  // it in the OAuth state — prevents a user from overwriting another user's row.
  let verifiedConnectionId: string | undefined;
  if (connectionId) {
    const connections = await listConnectionsForUser(clerkId);
    const owns = connections.some(c => c.id === connectionId);
    if (!owns) {
      res.status(403).json({ error: "Not authorized to reconnect this connection" });
      return;
    }
    verifiedConnectionId = connectionId;
  }

  const redirectUri = deriveRedirectUri(req);

  // Warn when using dynamic derivation in an environment where no fixed URI
  // is registered — Google will reject the flow if this URI isn't in the
  // Cloud Console's authorised redirect list.
  if (!process.env["GOOGLE_REDIRECT_URI"] && !process.env["APP_DOMAIN"] && !process.env["REPLIT_DOMAINS"]) {
    logger.warn({ redirectUri }, "Google Calendar connect-url: GOOGLE_REDIRECT_URI not set — derived URI may not match Google Cloud Console registration");
  }
  const url = getAuthUrl(
    clerkId,
    returnTo,
    returnOrigin && isTrustedOrigin(returnOrigin) ? returnOrigin : undefined,
    redirectUri,
    verifiedConnectionId,
  );
  res.json({ url });
});

// ── OAuth callback — no requireAuth: Google redirects here ──────────────────
// State is JSON { clerkId, returnTo } — tells us who connected and where to redirect.

router.get("/scheduling/google/callback", async (req, res): Promise<void> => {
  const { code, error, state: rawState } = req.query as {
    code?: string; error?: string; state?: string;
  };

  // Decode state — support both legacy string (plain clerkId) and new JSON format
  let clerkId: string | undefined;
  let returnTo     = "conferencing";
  let returnOrigin: string | undefined;
  let stateConnectionId: string | undefined;
  if (rawState) {
    try {
      const parsed = JSON.parse(rawState) as { clerkId?: string; returnTo?: string; returnOrigin?: string; connectionId?: string };
      clerkId           = parsed.clerkId;
      returnTo          = parsed.returnTo ?? "conferencing";
      returnOrigin      = parsed.returnOrigin;
      stateConnectionId = parsed.connectionId;
    } catch {
      // Legacy: state was just the clerkId string
      clerkId = rawState;
    }
  }

  // The Calendars page lives at /app/scheduling/calendars (where the BroadcastChannel
  // handler lives); the Conferencing tab lives at /app/settings/conferencing or
  // /app/scheduling/conferencing depending on which page initiated the OAuth flow.
  const redirectPath = returnTo === "calendar"
    ? "/app/scheduling/calendars"
    : returnTo === "scheduling-conferencing"
      ? "/app/scheduling/conferencing"
      : "/app/settings/conferencing";
  // If the request came from a dev preview, redirect the popup back to that origin
  // instead of the production domain so BroadcastChannel fires on the right page.
  const base = returnOrigin && isTrustedOrigin(returnOrigin) ? returnOrigin : DASHBOARD_BASE();
  const redirectBase = `${base}${redirectPath}`;

  if (error || !code || !clerkId) {
    logger.warn({ clerkId, error }, "Google OAuth callback error or missing params");
    res.redirect(`${redirectBase}?gcal=error`);
    return;
  }

  try {
    const redirectUri = deriveRedirectUri(req);
    const tokens = await exchangeCode(code, redirectUri);
    await upsertConnection(
      clerkId,
      tokens.email,
      tokens.accessToken,
      tokens.refreshToken,
      tokens.expiry,
      stateConnectionId,
      tokens.grantedScopes,
    );
    logger.info(
      { clerkId, email: tokens.email, updatedExistingId: stateConnectionId ?? null, grantedScopes: tokens.grantedScopes },
      "Google Calendar connected",
    );
    res.redirect(`${redirectBase}?gcal=connected&email=${encodeURIComponent(tokens.email)}`);
  } catch (err) {
    logger.warn({ err, clerkId }, "Failed to exchange Google OAuth code");
    res.redirect(`${redirectBase}?gcal=error`);
  }
});

// ── Test a Google Calendar connection ────────────────────────────────────────
// Calls calendarList.list to verify the token is valid and the API is reachable.
// Returns { ok: true, email } on success, { ok: false, error, status? } on failure.

router.post("/scheduling/google/connections/:id/test", requireAuth, async (req, res): Promise<void> => {
  const clerkId      = (req as any).clerkUserId as string;
  const connectionId = req.params["id"] as string;

  const connections = await listConnectionsForUser(clerkId);
  const conn = connections.find(c => c.id === connectionId);
  if (!conn) {
    res.status(403).json({ error: "Not authorized to test this connection" });
    return;
  }

  const tokens = await getValidAccessToken(connectionId);
  if (!tokens) {
    res.json({ ok: false, error: "token_invalid", status: 401 });
    return;
  }

  // Use listConnectionCalendars as a live reachability probe — it calls calendarList.list
  const cals = await listConnectionCalendars(connectionId);
  if (cals === null) {
    res.json({ ok: false, error: "calendar_api_error", status: 401 });
    return;
  }

  res.json({ ok: true, email: tokens.email });
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

// ── List Google sub-calendars across all connected accounts ─────────────────
// Returns one entry per Google sub-calendar (Personal, Work, etc.) the user
// has writer access to, annotated with the linked internal scheduling
// calendar id (if any). The dashboard uses this to drive the Book Appointment
// tool's Calendar dropdown.

router.get("/scheduling/google/calendars", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const connections = await listConnectionsForUser(clerkId);

  // Map: connectionId -> schedulingCalendarId (first one wins; usually 1:1)
  const { db } = await import("@workspace/db");
  const { sql } = await import("drizzle-orm");
  const linkRows = await db.execute(
    sql`SELECT id, google_calendar_connection_id FROM scheduling_calendars WHERE user_id = ${clerkId} AND google_calendar_connection_id IS NOT NULL`,
  );
  const connToSchedCal = new Map<string, number>();
  for (const r of linkRows.rows as any[]) {
    if (!connToSchedCal.has(r.google_calendar_connection_id)) {
      connToSchedCal.set(r.google_calendar_connection_id, r.id);
    }
  }

  const out: Array<{
    connectionId: string;
    connectionEmail: string;
    googleCalendarId: string;
    summary: string;
    primary: boolean;
    schedulingCalendarId: number | null;
  }> = [];

  await Promise.all(connections.map(async conn => {
    const cals = await listConnectionCalendars(conn.id);
    if (!cals) return;
    for (const c of cals) {
      out.push({
        connectionId: conn.id,
        connectionEmail: conn.email,
        googleCalendarId: c.googleCalendarId,
        summary: c.summary,
        primary: c.primary,
        schedulingCalendarId: connToSchedCal.get(conn.id) ?? null,
      });
    }
  }));

  res.json(out);
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

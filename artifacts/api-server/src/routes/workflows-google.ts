import { Router, type IRouter, type Request } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import {
  getSheetsAuthUrl,
  exchangeSheetsCode,
  upsertSheetsConnection,
  listSheetsConnectionsForUser,
  revokeSheetsConnection,
  listSpreadsheets,
  listSheets,
  getHeaderRow,
  isServiceAccountConfigured,
  getServiceAccountEmail,
  extractSpreadsheetId,
  getSpreadsheetMeta,
} from "../services/google-sheets.js";
import { verifyOAuthState } from "../services/scheduling/google-calendar.js";
import { logger } from "../lib/logger.js";
import { getAppOrigins, getSelfBaseUrl } from "../lib/app-domain.js";

const router: IRouter = Router();

const DASHBOARD_BASE = (): string =>
  process.env["APP_BASE_URL"] ? process.env["APP_BASE_URL"].replace(/\/$/, "") : getSelfBaseUrl();

function isTrustedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
    const host = url.hostname;
    if (process.env["APP_BASE_URL"]) {
      try { if (new URL(process.env["APP_BASE_URL"]).hostname === host) return true; } catch { /* ignore */ }
    }
    const trustedHosts = getAppOrigins().map(o => { try { return new URL(o).hostname; } catch { return ""; } }).filter(Boolean);
    if (trustedHosts.includes(host)) return true;
    if (/^[a-z0-9-]+\.replit\.dev$/.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

function deriveRedirectUri(req: Request): string {
  if (process.env["GOOGLE_SHEETS_REDIRECT_URI"]) return process.env["GOOGLE_SHEETS_REDIRECT_URI"];
  const forwardedHost = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim();
  const forwardedProto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? "https";
  const host = forwardedHost ?? req.hostname;
  if (host && isTrustedOrigin(`${forwardedProto}://${host}`)) {
    return `${forwardedProto}://${host}/api/workflows/google/callback`;
  }
  return `${getSelfBaseUrl()}/api/workflows/google/callback`;
}

// ── Service-account mode: share-a-sheet, no OAuth ───────────────────────────
//
// The simplest path for non-technical users: they paste a Google Sheet URL and
// share it with our service-account email. No "Connect Google" flow required.

router.get("/workflows/sheets/service-account", requireAuth, async (_req, res): Promise<void> => {
  res.json({
    enabled: isServiceAccountConfigured(),
    email: getServiceAccountEmail(),
  });
});

router.post("/workflows/sheets/verify", requireAuth, async (req, res): Promise<void> => {
  const url = String((req.body as { url?: string } | undefined)?.url ?? "");
  const spreadsheetId = extractSpreadsheetId(url);
  if (!spreadsheetId) {
    res.status(400).json({ error: "That doesn't look like a Google Sheet URL." });
    return;
  }
  try {
    const meta = await getSpreadsheetMeta(spreadsheetId);
    res.json({ spreadsheetId, title: meta.title, tabs: meta.tabs });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Couldn't open that sheet." });
  }
});

// ── List connected Google (Sheets) accounts ─────────────────────────────────
router.get("/workflows/google/connections", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const connections = await listSheetsConnectionsForUser(clerkId);
  res.json(connections.map(c => ({
    id: c.id,
    email: c.email,
    connectedAt: c.createdAt,
    scopeValid: c.hasSpreadsheetsScope,
  })));
});

// ── OAuth connect URL (JSON, for Bearer-token callers) ──────────────────────
router.get("/workflows/google/connect-url", requireAuth, (req, res): void => {
  const clerkId = (req as any).clerkUserId as string;
  const returnOrigin = req.query["returnOrigin"] as string | undefined;
  if (!process.env["GOOGLE_CLIENT_ID"] || !process.env["GOOGLE_CLIENT_SECRET"]) {
    res.status(503).json({ error: "Google OAuth not configured on this platform." });
    return;
  }
  const redirectUri = deriveRedirectUri(req);
  const url = getSheetsAuthUrl(
    clerkId,
    "workflows",
    returnOrigin && isTrustedOrigin(returnOrigin) ? returnOrigin : undefined,
    redirectUri,
  );
  res.json({ url });
});

// ── OAuth connect — 302 redirect to Google consent ──────────────────────────
router.get("/workflows/google/connect", requireAuth, (req, res): void => {
  const clerkId = (req as any).clerkUserId as string;
  const returnOrigin = req.query["returnOrigin"] as string | undefined;
  if (!process.env["GOOGLE_CLIENT_ID"] || !process.env["GOOGLE_CLIENT_SECRET"]) {
    res.status(503).json({ error: "Google OAuth not configured on this platform." });
    return;
  }
  const redirectUri = deriveRedirectUri(req);
  res.redirect(getSheetsAuthUrl(
    clerkId,
    "workflows",
    returnOrigin && isTrustedOrigin(returnOrigin) ? returnOrigin : undefined,
    redirectUri,
  ));
});

// ── OAuth callback — Google redirects here (no requireAuth) ──────────────────
router.get("/workflows/google/callback", async (req, res): Promise<void> => {
  const { code, error, state: rawState } = req.query as { code?: string; error?: string; state?: string };
  const statePayload = verifyOAuthState(rawState);
  const clerkId = statePayload?.clerkId;
  const returnOrigin = statePayload?.returnOrigin;
  const base = returnOrigin && isTrustedOrigin(returnOrigin) ? returnOrigin : DASHBOARD_BASE();
  const redirectBase = `${base}/app/workflows`;

  if (error || !code || !clerkId || !statePayload) {
    logger.warn({ clerkId, error, stateVerified: !!statePayload }, "Sheets OAuth callback error/invalid state");
    res.redirect(`${redirectBase}?gsheets=error`);
    return;
  }
  try {
    const tokens = await exchangeSheetsCode(code);
    await upsertSheetsConnection(clerkId, tokens.email, tokens.accessToken, tokens.refreshToken, tokens.expiry, tokens.grantedScopes);
    logger.info({ clerkId, email: tokens.email }, "Google Sheets connected");
    res.redirect(`${redirectBase}?gsheets=connected&email=${encodeURIComponent(tokens.email)}`);
  } catch (err) {
    logger.warn({ err, clerkId }, "Failed to exchange Sheets OAuth code");
    res.redirect(`${redirectBase}?gsheets=error`);
  }
});

// ── Disconnect ───────────────────────────────────────────────────────────────
router.delete("/workflows/google/connections/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  await revokeSheetsConnection(String(req.params["id"]), clerkId);
  res.sendStatus(204);
});

// ── Spreadsheet / sheet / header pickers ─────────────────────────────────────
async function assertOwnsConnection(clerkId: string, connectionId: string): Promise<boolean> {
  const conns = await listSheetsConnectionsForUser(clerkId);
  return conns.some(c => c.id === connectionId);
}

router.get("/workflows/google/spreadsheets", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const connectionId = String(req.query["connectionId"] ?? "");
  if (!connectionId || !(await assertOwnsConnection(clerkId, connectionId))) {
    res.status(403).json({ error: "Unknown connection" });
    return;
  }
  res.json(await listSpreadsheets(connectionId));
});

router.get("/workflows/google/sheets", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const connectionId = String(req.query["connectionId"] ?? "");
  const spreadsheetId = String(req.query["spreadsheetId"] ?? "");
  if (!connectionId || !(await assertOwnsConnection(clerkId, connectionId))) {
    res.status(403).json({ error: "Unknown connection" });
    return;
  }
  res.json(await listSheets(connectionId, spreadsheetId));
});

router.get("/workflows/google/columns", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const connectionId = String(req.query["connectionId"] ?? "");
  const spreadsheetId = String(req.query["spreadsheetId"] ?? "");
  const sheetName = String(req.query["sheetName"] ?? "");
  if (!connectionId || !(await assertOwnsConnection(clerkId, connectionId))) {
    res.status(403).json({ error: "Unknown connection" });
    return;
  }
  res.json(await getHeaderRow(connectionId, spreadsheetId, sheetName));
});

export default router;

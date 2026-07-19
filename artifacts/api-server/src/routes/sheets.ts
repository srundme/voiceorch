/**
 * Google Sheets Phase 01 API — OAuth connect, list/create spreadsheets,
 * and multi-sheet agent bindings.
 */

import { Router, type IRouter, type Request } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
import { getAppOrigins, getSelfBaseUrl } from "../lib/app-domain.js";
import {
  getSheetsAuthUrl,
  exchangeSheetsCode,
  upsertSheetsConnection,
  listSheetsConnections,
  revokeSheetsConnection,
  listSpreadsheets,
  listSheetTabs,
  createSpreadsheet,
  listAgentBindings,
  createAgentBinding,
  updateAgentBinding,
  deleteAgentBinding,
  verifyOAuthState,
  deriveSheetsRedirectUri,
  type SheetTemplate,
} from "../services/google-sheets.js";
import type { SheetUseCase } from "@workspace/db";

const router: IRouter = Router();

const USE_CASES: SheetUseCase[] = ["lookup", "call_log", "outcome", "custom"];

function isTrustedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return false;
    const host = url.hostname;
    if (process.env["APP_BASE_URL"]) {
      try {
        if (new URL(process.env["APP_BASE_URL"]).hostname === host) return true;
      } catch { /* ignore */ }
    }
    const trustedHosts = getAppOrigins().map((o) => {
      try { return new URL(o).hostname; } catch { return ""; }
    }).filter(Boolean);
    if (trustedHosts.includes(host)) return true;
    if (host === "localhost" || host === "127.0.0.1") return true;
    if (/^[a-z0-9-]+-\d{2}-[a-z0-9]+\.sisko\.replit\.dev$/.test(host)) return true;
    if (/^[a-z0-9-]+\.replit\.dev$/.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

function redirectUriFromReq(req: Request): string {
  if (process.env["GOOGLE_SHEETS_REDIRECT_URI"]) {
    return process.env["GOOGLE_SHEETS_REDIRECT_URI"];
  }
  const forwardedHost = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim();
  const forwardedProto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? "https";
  const host = forwardedHost ?? req.hostname;
  if (host && isTrustedOrigin(`${forwardedProto}://${host}`)) {
    return `${forwardedProto}://${host}/api/sheets/google/callback`;
  }
  return deriveSheetsRedirectUri();
}

function dashboardBase(): string {
  if (process.env["APP_BASE_URL"]) return process.env["APP_BASE_URL"].replace(/\/$/, "");
  return getSelfBaseUrl();
}

// ── OAuth ────────────────────────────────────────────────────────────────────

router.get("/sheets/google/connect-url", requireAuth, async (req, res): Promise<void> => {
  try {
    const clerkId = (req as any).clerkUserId as string;
    const returnTo = typeof req.query["returnTo"] === "string" ? req.query["returnTo"] : "sheets";
    const returnOrigin = typeof req.query["returnOrigin"] === "string" ? req.query["returnOrigin"] : undefined;
    const connectionId = typeof req.query["connectionId"] === "string" ? req.query["connectionId"] : undefined;
    if (returnOrigin && !isTrustedOrigin(returnOrigin)) {
      res.status(400).json({ error: "Untrusted returnOrigin" });
      return;
    }
    const redirectUri = redirectUriFromReq(req);
    const url = getSheetsAuthUrl(clerkId, returnTo, returnOrigin, redirectUri, connectionId);
    res.json({ url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "sheets: connect-url failed");
    res.status(500).json({ error: msg.includes("GOOGLE_CLIENT") ? "Google OAuth is not configured on this server." : "Failed to start Google Sheets connect" });
  }
});

router.get("/sheets/google/callback", async (req, res): Promise<void> => {
  const code = typeof req.query["code"] === "string" ? req.query["code"] : "";
  const stateRaw = typeof req.query["state"] === "string" ? req.query["state"] : "";
  const state = verifyOAuthState(stateRaw);
  const failRedirect = (msg: string) => {
    res.redirect(`${dashboardBase()}/app/connections?sheets=error&reason=${encodeURIComponent(msg)}`);
  };
  if (!code || !state) {
    failRedirect("Invalid or expired OAuth state");
    return;
  }
  try {
    const redirectUri = redirectUriFromReq(req);
    const tokens = await exchangeSheetsCode(code, redirectUri);
    await upsertSheetsConnection(
      state.clerkId,
      tokens.email,
      tokens.accessToken,
      tokens.refreshToken,
      tokens.expiry,
      state.connectionId,
      tokens.grantedScopes,
    );
    logger.info({ clerkId: state.clerkId, email: tokens.email }, "Google Sheets connected");
    const origin = state.returnOrigin && isTrustedOrigin(state.returnOrigin)
      ? state.returnOrigin
      : dashboardBase();
    const returnTo = state.returnTo === "agent" ? "/app/agents" : "/app/connections";
    res.redirect(`${origin}${returnTo}?sheets=connected`);
  } catch (err) {
    logger.error({ err }, "sheets: OAuth callback failed");
    failRedirect(err instanceof Error ? err.message : "OAuth failed");
  }
});

router.get("/sheets/google/connections", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const rows = await listSheetsConnections(clerkId);
  res.json(rows);
});

router.delete("/sheets/google/connections/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const ok = await revokeSheetsConnection(clerkId, String(req.params["id"]));
  if (!ok) { res.status(404).json({ error: "Connection not found" }); return; }
  res.sendStatus(204);
});

// ── Spreadsheets ─────────────────────────────────────────────────────────────

router.get("/sheets/google/connections/:id/spreadsheets", requireAuth, async (req, res): Promise<void> => {
  try {
    const clerkId = (req as any).clerkUserId as string;
    const files = await listSpreadsheets(clerkId, String(req.params["id"]));
    res.json(files);
  } catch (err) {
    logger.warn({ err }, "sheets: listSpreadsheets failed");
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to list spreadsheets" });
  }
});

router.get("/sheets/google/connections/:id/spreadsheets/:spreadsheetId/tabs", requireAuth, async (req, res): Promise<void> => {
  try {
    const clerkId = (req as any).clerkUserId as string;
    const tabs = await listSheetTabs(clerkId, String(req.params["id"]), String(req.params["spreadsheetId"]));
    res.json(tabs);
  } catch (err) {
    logger.warn({ err }, "sheets: listSheetTabs failed");
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to list tabs" });
  }
});

router.post("/sheets/google/connections/:id/spreadsheets", requireAuth, async (req, res): Promise<void> => {
  try {
    const clerkId = (req as any).clerkUserId as string;
    const body = req.body as { title?: string; template?: SheetTemplate };
    const title = (body.title ?? "").trim() || "SnapServe Sheet";
    const template = body.template && ["blank", "call_log", "lead_pipeline"].includes(body.template)
      ? body.template
      : "blank";
    const created = await createSpreadsheet(clerkId, String(req.params["id"]), { title, template });
    res.status(201).json(created);
  } catch (err) {
    logger.error({ err }, "sheets: createSpreadsheet failed");
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to create spreadsheet" });
  }
});

// ── Agent bindings ───────────────────────────────────────────────────────────

router.get("/agents/:agentId/sheets", requireAuth, async (req, res): Promise<void> => {
  try {
    const clerkId = (req as any).clerkUserId as string;
    const agentId = parseInt(String(req.params["agentId"]), 10);
    if (!Number.isFinite(agentId)) { res.status(400).json({ error: "Invalid agentId" }); return; }
    const rows = await listAgentBindings(clerkId, agentId);
    res.json(rows);
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "Not found" });
  }
});

router.post("/agents/:agentId/sheets", requireAuth, async (req, res): Promise<void> => {
  try {
    const clerkId = (req as any).clerkUserId as string;
    const agentId = parseInt(String(req.params["agentId"]), 10);
    if (!Number.isFinite(agentId)) { res.status(400).json({ error: "Invalid agentId" }); return; }
    const body = req.body as {
      connectionId?: string;
      label?: string;
      useCase?: string;
      spreadsheetId?: string;
      spreadsheetTitle?: string;
      sheetName?: string;
      sheetGid?: number | null;
      matchColumn?: string | null;
    };
    if (!body.connectionId || !body.spreadsheetId || !body.sheetName) {
      res.status(400).json({ error: "connectionId, spreadsheetId, and sheetName are required" });
      return;
    }
    const useCase = (USE_CASES.includes(body.useCase as SheetUseCase)
      ? body.useCase
      : "custom") as SheetUseCase;
    const row = await createAgentBinding(clerkId, {
      agentId,
      connectionId: body.connectionId,
      label: body.label ?? "Sheet",
      useCase,
      spreadsheetId: body.spreadsheetId,
      spreadsheetTitle: body.spreadsheetTitle,
      sheetName: body.sheetName,
      sheetGid: body.sheetGid,
      matchColumn: body.matchColumn,
    });
    res.status(201).json(row);
  } catch (err) {
    logger.warn({ err }, "sheets: createAgentBinding failed");
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to bind sheet" });
  }
});

router.patch("/agents/:agentId/sheets/:bindingId", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const body = req.body as Partial<{
    label: string;
    useCase: SheetUseCase;
    sheetName: string;
    sheetGid: number | null;
    matchColumn: string | null;
    enabled: boolean;
    columnMap: Record<string, string>;
  }>;
  const patch: Record<string, unknown> = {};
  if (body.label !== undefined) patch["label"] = body.label;
  if (body.useCase !== undefined && USE_CASES.includes(body.useCase)) patch["useCase"] = body.useCase;
  if (body.sheetName !== undefined) patch["sheetName"] = body.sheetName;
  if (body.sheetGid !== undefined) patch["sheetGid"] = body.sheetGid;
  if (body.matchColumn !== undefined) patch["matchColumn"] = body.matchColumn;
  if (body.enabled !== undefined) patch["enabled"] = body.enabled;
  if (body.columnMap !== undefined) patch["columnMap"] = body.columnMap;
  const row = await updateAgentBinding(clerkId, String(req.params["bindingId"]), patch as never);
  if (!row) { res.status(404).json({ error: "Binding not found" }); return; }
  res.json(row);
});

router.delete("/agents/:agentId/sheets/:bindingId", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const ok = await deleteAgentBinding(clerkId, String(req.params["bindingId"]));
  if (!ok) { res.status(404).json({ error: "Binding not found" }); return; }
  res.sendStatus(204);
});

export default router;

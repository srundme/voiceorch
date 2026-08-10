/**
 * Hosted SnapServe remote MCP (Streamable HTTP) + OAuth for Claude custom connectors.
 *
 * URL: https://app.snapserve.ai/api/mcp
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { SnapServe } from "@snapserveai/sdk";
import { createSnapServeMcpServer } from "@snapserveai/mcp";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { logger } from "../lib/logger.js";
import {
  exchangeAuthorizationCode,
  issueAuthorizationCode,
  mcpResourceUrl,
  oauthAuthorizationServerMetadata,
  oauthProtectedResourceMetadata,
  registerOauthClient,
  resolveMcpApiKey,
  revokeAccessToken,
  signAuthorizeState,
  validateApiKeyForOauth,
  verifyAuthorizeState,
} from "../services/mcp-oauth.js";

const router: IRouter = Router();

type SessionEntry = {
  transport: StreamableHTTPServerTransport;
  apiKey: string;
};

const sessions = new Map<string, SessionEntry>();

function resourceMetadataUrl(): string {
  return `${getSelfBaseUrl()}/.well-known/oauth-protected-resource`;
}

function wwwAuthenticateHeader(): string {
  return `Bearer realm="SnapServe MCP", resource_metadata="${resourceMetadataUrl()}"`;
}

function apiBaseUrl(): string {
  return `${getSelfBaseUrl()}/api`;
}

async function requireMcpAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const creds = await resolveMcpApiKey(
    req.headers.authorization,
    typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : undefined,
  );
  if (!creds) {
    res.setHeader("WWW-Authenticate", wwwAuthenticateHeader());
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized — use Bearer sk_live_… or connect via OAuth" },
      id: null,
    });
    return;
  }
  (req as any).mcpApiKey = creds.apiKey;
  (req as any).clerkUserId = creds.userId;
  next();
}

function authorizePageHtml(opts: {
  error?: string;
  stateToken: string;
  clientId: string;
  redirectUri: string;
}): string {
  const err = opts.error
    ? `<p style="color:#b91c1c;background:#fef2f2;padding:10px 12px;border-radius:8px">${escapeHtml(opts.error)}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connect SnapServe to Claude</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; background:#0f172a; color:#e2e8f0; margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
    .card { width:100%; max-width:420px; background:#1e293b; border:1px solid #334155; border-radius:16px; padding:28px; box-shadow:0 20px 40px rgba(0,0,0,.35); }
    h1 { font-size:1.25rem; margin:0 0 8px; }
    p { color:#94a3b8; font-size:.925rem; line-height:1.45; margin:0 0 16px; }
    label { display:block; font-size:.8rem; color:#cbd5e1; margin-bottom:6px; }
    input { width:100%; box-sizing:border-box; padding:12px; border-radius:10px; border:1px solid #475569; background:#0f172a; color:#f8fafc; font-size:.95rem; }
    button { margin-top:14px; width:100%; padding:12px; border:0; border-radius:10px; background:#f97316; color:#0f172a; font-weight:700; cursor:pointer; font-size:.95rem; }
    button:hover { background:#fb923c; }
    .hint { font-size:.75rem; color:#64748b; margin-top:12px; }
    a { color:#fdba74; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect SnapServe</h1>
    <p>Paste a SnapServe API key to allow Claude to manage agents, calls, and analytics on your account.</p>
    ${err}
    <form method="POST" action="/api/mcp/oauth/authorize">
      <input type="hidden" name="state_token" value="${escapeHtml(opts.stateToken)}" />
      <label for="api_key">API key (sk_live_…)</label>
      <input id="api_key" name="api_key" type="password" autocomplete="off" required placeholder="sk_live_…" />
      <button type="submit">Authorize Claude</button>
    </form>
    <p class="hint">Create a key in <a href="https://app.snapserve.ai" target="_blank" rel="noreferrer">Dashboard → API Keys</a>. You can revoke the key anytime to disconnect.</p>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ── Well-known metadata (also mounted at app root) ──────────────────────── */

export function mountMcpWellKnown(appRouter: {
  get: (path: string, ...handlers: Array<(req: Request, res: Response) => void>) => unknown;
}): void {
  appRouter.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json(oauthAuthorizationServerMetadata());
  });
  appRouter.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json(oauthProtectedResourceMetadata());
  });
  // Path-based discovery used by some MCP clients
  appRouter.get("/.well-known/oauth-protected-resource/api/mcp", (_req, res) => {
    res.json(oauthProtectedResourceMetadata());
  });
}

/* ── OAuth ───────────────────────────────────────────────────────────────── */

router.post("/mcp/oauth/register", async (req, res): Promise<void> => {
  try {
    const body = req.body as {
      client_name?: string;
      redirect_uris?: string[];
      token_endpoint_auth_method?: string;
    };
    const registered = await registerOauthClient({
      client_name: body.client_name,
      redirect_uris: body.redirect_uris ?? [],
      token_endpoint_auth_method: body.token_endpoint_auth_method,
    });
    res.status(201).json(registered);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: "invalid_client_metadata", error_description: msg });
  }
});

router.get("/mcp/oauth/authorize", (req, res): void => {
  const clientId = String(req.query["client_id"] ?? "");
  const redirectUri = String(req.query["redirect_uri"] ?? "");
  const state = String(req.query["state"] ?? "");
  const codeChallenge = String(req.query["code_challenge"] ?? "");
  const codeChallengeMethod = String(req.query["code_challenge_method"] ?? "S256");
  const responseType = String(req.query["response_type"] ?? "code");

  if (!clientId || !redirectUri || !codeChallenge) {
    res.status(400).send("Missing client_id, redirect_uri, or code_challenge");
    return;
  }
  if (responseType !== "code") {
    res.status(400).send("Only response_type=code is supported");
    return;
  }

  const stateToken = signAuthorizeState({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
  });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(authorizePageHtml({ stateToken, clientId, redirectUri }));
});

router.post("/mcp/oauth/authorize", async (req, res): Promise<void> => {
  const body = req.body as { state_token?: string; api_key?: string };
  const payload = body.state_token ? verifyAuthorizeState(body.state_token) : null;
  if (!payload) {
    res.status(400).send("Invalid authorize session — start again from Claude.");
    return;
  }

  const stateToken = body.state_token!;
  const renderError = (error: string) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(400).send(
      authorizePageHtml({
        error,
        stateToken,
        clientId: payload["client_id"] ?? "",
        redirectUri: payload["redirect_uri"] ?? "",
      }),
    );
  };

  const validated = await validateApiKeyForOauth(String(body.api_key ?? ""));
  if (!validated) {
    renderError("Invalid or revoked API key. Create one in Dashboard → API Keys.");
    return;
  }

  try {
    const code = await issueAuthorizationCode({
      clientId: payload["client_id"]!,
      redirectUri: payload["redirect_uri"]!,
      codeChallenge: payload["code_challenge"]!,
      codeChallengeMethod: payload["code_challenge_method"] || "S256",
      userId: validated.userId,
      apiKey: validated.apiKey,
    });
    const redirect = new URL(payload["redirect_uri"]!);
    redirect.searchParams.set("code", code);
    if (payload["state"]) redirect.searchParams.set("state", payload["state"]);
    res.redirect(302, redirect.toString());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "MCP OAuth authorize failed");
    renderError(msg);
  }
});

router.post("/mcp/oauth/token", async (req, res): Promise<void> => {
  try {
    const body = req.body as Record<string, string | undefined>;
    const grantType = body["grant_type"];
    if (grantType !== "authorization_code") {
      res.status(400).json({ error: "unsupported_grant_type" });
      return;
    }

    let clientId = body["client_id"] ?? "";
    let clientSecret = body["client_secret"];
    const auth = req.headers.authorization;
    if (auth?.startsWith("Basic ")) {
      const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
      const [id, secret] = decoded.split(":");
      if (id) clientId = id;
      if (secret) clientSecret = secret;
    }

    const tokens = await exchangeAuthorizationCode({
      clientId,
      clientSecret,
      code: String(body["code"] ?? ""),
      redirectUri: String(body["redirect_uri"] ?? ""),
      codeVerifier: String(body["code_verifier"] ?? ""),
    });
    res.json(tokens);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "MCP OAuth token exchange failed");
    res.status(400).json({ error: "invalid_grant", error_description: msg });
  }
});

router.post("/mcp/oauth/revoke", async (req, res): Promise<void> => {
  const token = String((req.body as { token?: string })?.token ?? "");
  await revokeAccessToken(token);
  res.status(200).json({ revoked: true });
});

/* ── Streamable HTTP MCP ─────────────────────────────────────────────────── */

async function handleMcpPost(req: Request, res: Response): Promise<void> {
  const apiKey = (req as any).mcpApiKey as string;
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  try {
    let transport: StreamableHTTPServerTransport;

    if (sessionId && sessions.has(sessionId)) {
      const entry = sessions.get(sessionId)!;
      if (entry.apiKey !== apiKey) {
        res.status(403).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session belongs to a different credential" },
          id: null,
        });
        return;
      }
      transport = entry.transport;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          sessions.set(sid, { transport, apiKey });
        },
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) sessions.delete(sid);
      };

      const snapserve = new SnapServe({ apiKey, baseUrl: apiBaseUrl() });
      const server = createSnapServeMcpServer(snapserve);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // Stateless fallback: one-shot request (no session header)
    if (!sessionId) {
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const snapserve = new SnapServe({ apiKey, baseUrl: apiBaseUrl() });
      const server = createSnapServeMcpServer(snapserve);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      return;
    }

    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: No valid session ID provided" },
      id: null,
    });
  } catch (err) {
    logger.error({ err }, "MCP HTTP request failed");
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
}

async function handleMcpGet(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  const entry = sessions.get(sessionId)!;
  const apiKey = (req as any).mcpApiKey as string;
  if (entry.apiKey !== apiKey) {
    res.status(403).send("Session belongs to a different credential");
    return;
  }
  await entry.transport.handleRequest(req, res);
}

async function handleMcpDelete(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(404).send("Unknown session");
    return;
  }
  const entry = sessions.get(sessionId)!;
  sessions.delete(sessionId);
  await entry.transport.close();
  res.status(200).end();
}

router.post("/mcp", requireMcpAuth, (req, res) => {
  void handleMcpPost(req, res);
});
router.get("/mcp", requireMcpAuth, (req, res) => {
  void handleMcpGet(req, res);
});
router.delete("/mcp", requireMcpAuth, (req, res) => {
  void handleMcpDelete(req, res);
});

// Discovery helper for humans / docs
router.get("/mcp/info", (_req, res): void => {
  res.json({
    name: "snapserve",
    url: mcpResourceUrl(),
    auth: {
      api_key_header: "Authorization: Bearer sk_live_…",
      oauth: "Claude Connect → paste API key on authorize page",
    },
    docs: "https://app.snapserve.ai/docs/sdks#mcp",
  });
});

export default router;

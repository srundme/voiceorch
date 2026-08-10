/**
 * Minimal MCP OAuth for Claude custom connectors.
 * Authorize by pasting a SnapServe API key (sk_live_…); issue opaque mcp_at_ tokens.
 */
import { createHash, randomBytes, createHmac } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  db,
  userApiKeysTable,
  mcpOauthClientsTable,
  mcpOauthCodesTable,
  mcpOauthTokensTable,
} from "@workspace/db";
import { encryptKey, decryptKey } from "../lib/crypto.js";
import { hashKey } from "../routes/user-api-keys.js";
import { getSelfBaseUrl } from "../lib/app-domain.js";

const CODE_TTL_MS = 10 * 60 * 1000;
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function base64UrlSha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function mcpResourceUrl(): string {
  return `${getSelfBaseUrl()}/api/mcp`;
}

export function mcpIssuerUrl(): string {
  return getSelfBaseUrl();
}

export function oauthAuthorizationServerMetadata() {
  const issuer = mcpIssuerUrl();
  return {
    issuer,
    authorization_endpoint: `${issuer}/api/mcp/oauth/authorize`,
    token_endpoint: `${issuer}/api/mcp/oauth/token`,
    registration_endpoint: `${issuer}/api/mcp/oauth/register`,
    revocation_endpoint: `${issuer}/api/mcp/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: ["mcp:tools"],
  };
}

export function oauthProtectedResourceMetadata() {
  const resource = mcpResourceUrl();
  const issuer = mcpIssuerUrl();
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: ["mcp:tools"],
    bearer_methods_supported: ["header"],
    resource_name: "SnapServe MCP",
    resource_documentation: "https://app.snapserve.ai/docs/sdks#mcp",
  };
}

export async function registerOauthClient(input: {
  client_name?: string;
  redirect_uris: string[];
  token_endpoint_auth_method?: string;
}): Promise<{
  client_id: string;
  client_secret: string;
  client_id_issued_at: number;
  client_name?: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
}> {
  const redirectUris = (input.redirect_uris ?? []).filter((u) => typeof u === "string" && u.length > 0);
  if (redirectUris.length === 0) {
    throw new Error("redirect_uris required");
  }
  const clientId = `mcp_cli_${randomBytes(16).toString("hex")}`;
  const authMethod = input.token_endpoint_auth_method ?? "none";
  let clientSecret: string | undefined;
  if (authMethod !== "none") {
    clientSecret = `mcp_sec_${randomBytes(24).toString("hex")}`;
  }
  // Always mint a secret — Claude custom connectors often expect both client_id
  // and client_secret even when auth_method is "none".
  if (!clientSecret) {
    clientSecret = `mcp_sec_${randomBytes(24).toString("hex")}`;
  }
  await db.insert(mcpOauthClientsTable).values({
    clientId,
    clientSecret: sha256Hex(clientSecret),
    clientName: input.client_name ?? null,
    redirectUris: JSON.stringify(redirectUris),
  });
  return {
    client_id: clientId,
    client_secret: clientSecret,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: input.client_name,
    redirect_uris: redirectUris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: authMethod,
  };
}

async function getClient(clientId: string) {
  const [row] = await db
    .select()
    .from(mcpOauthClientsTable)
    .where(eq(mcpOauthClientsTable.clientId, clientId))
    .limit(1);
  return row ?? null;
}

function parseRedirectUris(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function validateApiKeyForOauth(rawKey: string): Promise<{ userId: string; apiKey: string } | null> {
  const key = rawKey.trim();
  if (!key.startsWith("sk_live_")) return null;
  const [row] = await db
    .select()
    .from(userApiKeysTable)
    .where(and(eq(userApiKeysTable.keyHash, hashKey(key)), isNull(userApiKeysTable.revokedAt)))
    .limit(1);
  if (!row) return null;
  return { userId: row.userId, apiKey: key };
}

export async function issueAuthorizationCode(opts: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  userId: string;
  apiKey: string;
}): Promise<string> {
  const client = await getClient(opts.clientId);
  if (!client) throw new Error("Unknown client_id");
  const uris = parseRedirectUris(client.redirectUris);
  if (!uris.includes(opts.redirectUri)) throw new Error("redirect_uri not registered for this client");
  if (opts.codeChallengeMethod !== "S256") throw new Error("Only S256 PKCE is supported");

  const code = `mcp_ac_${randomBytes(24).toString("hex")}`;
  await db.insert(mcpOauthCodesTable).values({
    codeHash: sha256Hex(code),
    clientId: opts.clientId,
    userId: opts.userId,
    redirectUri: opts.redirectUri,
    codeChallenge: opts.codeChallenge,
    codeChallengeMethod: opts.codeChallengeMethod,
    apiKeyCiphertext: encryptKey(opts.apiKey),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  return code;
}

export async function exchangeAuthorizationCode(opts: {
  clientId: string;
  clientSecret?: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{ access_token: string; token_type: "Bearer"; expires_in: number; scope: string }> {
  const client = await getClient(opts.clientId);
  if (!client) throw new Error("Invalid client");
  // Public clients (Claude DCR with auth_method=none) often omit client_secret
  // and rely on PKCE. If a secret is supplied, it must match.
  if (opts.clientSecret && client.clientSecret) {
    if (sha256Hex(opts.clientSecret) !== client.clientSecret) {
      throw new Error("Invalid client credentials");
    }
  }

  const [row] = await db
    .select()
    .from(mcpOauthCodesTable)
    .where(
      and(
        eq(mcpOauthCodesTable.codeHash, sha256Hex(opts.code)),
        eq(mcpOauthCodesTable.clientId, opts.clientId),
        isNull(mcpOauthCodesTable.usedAt),
        gt(mcpOauthCodesTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Invalid or expired authorization code");
  if (row.redirectUri !== opts.redirectUri) throw new Error("redirect_uri mismatch");

  const expected = base64UrlSha256(opts.codeVerifier);
  if (expected !== row.codeChallenge) throw new Error("PKCE verification failed");

  await db
    .update(mcpOauthCodesTable)
    .set({ usedAt: new Date() })
    .where(eq(mcpOauthCodesTable.id, row.id));

  const accessToken = `mcp_at_${randomBytes(32).toString("hex")}`;
  const expiresIn = Math.floor(TOKEN_TTL_MS / 1000);
  await db.insert(mcpOauthTokensTable).values({
    tokenHash: sha256Hex(accessToken),
    clientId: opts.clientId,
    userId: row.userId,
    apiKeyCiphertext: row.apiKeyCiphertext,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  });

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: expiresIn,
    scope: "mcp:tools",
  };
}

export async function revokeAccessToken(token: string): Promise<void> {
  const raw = token.trim();
  if (!raw.startsWith("mcp_at_")) return;
  await db
    .update(mcpOauthTokensTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(mcpOauthTokensTable.tokenHash, sha256Hex(raw)), isNull(mcpOauthTokensTable.revokedAt)));
}

/** Resolve Bearer credential to a live SnapServe API key. */
export async function resolveMcpApiKey(authorizationHeader: string | undefined, xApiKey?: string): Promise<{
  apiKey: string;
  userId: string;
} | null> {
  let raw: string | null = null;
  if (xApiKey?.trim()) {
    raw = xApiKey.trim();
  } else if (authorizationHeader) {
    const h = authorizationHeader.trim();
    if (h.toLowerCase().startsWith("bearer ")) raw = h.slice(7).trim();
    else raw = h;
  }
  if (!raw) return null;

  if (raw.startsWith("sk_live_")) {
    return validateApiKeyForOauth(raw);
  }

  if (raw.startsWith("mcp_at_")) {
    const [row] = await db
      .select()
      .from(mcpOauthTokensTable)
      .where(
        and(
          eq(mcpOauthTokensTable.tokenHash, sha256Hex(raw)),
          isNull(mcpOauthTokensTable.revokedAt),
          gt(mcpOauthTokensTable.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!row) return null;
    try {
      const apiKey = decryptKey(row.apiKeyCiphertext);
      return { apiKey, userId: row.userId };
    } catch {
      return null;
    }
  }

  return null;
}

/** CSRF-ish state binder for authorize form (optional hardening). */
export function signAuthorizeState(payload: Record<string, string>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", process.env["APP_SECRET"] ?? "snapserve-mcp")
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

export function verifyAuthorizeState(token: string): Record<string, string> | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", process.env["APP_SECRET"] ?? "snapserve-mcp")
    .update(body)
    .digest("base64url");
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, string>;
  } catch {
    return null;
  }
}

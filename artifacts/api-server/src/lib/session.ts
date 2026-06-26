/**
 * Platform-issued session tokens (standalone Google auth).
 *
 * A compact HS256 JWT signed with SESSION_SECRET. The token carries the Google
 * account subject id (`sub`, stored in users.clerk_id) plus the user's email and
 * name so the server can provision / heal identity without re-calling Google on
 * every request.
 *
 * Format:  base64url(header).base64url(payload).base64url(HMAC-SHA256)
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { APP_SECRET } from "./app-secret.js";

const SECRET = APP_SECRET;
const DEFAULT_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

export interface SessionPayload {
  /** Google account subject id — stored in users.clerk_id. */
  sub: string;
  email: string | null;
  name: string | null;
  iat: number;
  exp: number;
  /**
   * Present only on impersonation tokens. Carries the opaque
   * admin_impersonation_sessions.session_token so that attachSession can
   * check server-side revocation on every request — impersonation JWTs are
   * NOT purely stateless.
   */
  imp?: string;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function sign(data: string): string {
  return createHmac("sha256", SECRET).update(data).digest("base64url");
}

export function createSessionToken(
  input: { sub: string; email: string | null; name: string | null; imp?: string },
  ttlSec: number = DEFAULT_TTL_SEC,
): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: input.sub,
    email: input.email,
    name: input.name,
    iat: now,
    exp: now + ttlSec,
    ...(input.imp ? { imp: input.imp } : {}),
  };
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  return `${data}.${sign(data)}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, providedSig] = parts as [string, string, string];
    const data = `${header}.${body}`;
    const expected = Buffer.from(sign(data), "utf8");
    const provided = Buffer.from(providedSig, "utf8");
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!payload || typeof payload.sub !== "string" || !payload.sub) return null;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Pull a bearer token from the Authorization header, or `?token=` query (EventSource). */
export function extractRequestToken(req: Request): string | null {
  const header = req.headers["authorization"];
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    const t = header.slice(7).trim();
    if (t) return t;
  }
  const q = req.query?.["token"];
  if (typeof q === "string" && q) return q;
  return null;
}

/**
 * HttpOnly dashboard session cookie.
 *
 * The JWT never needs to be readable by JavaScript — XSS can still *use* a
 * cookie (SameSite=Lax same-origin fetches), but it cannot exfiltrate it to
 * another origin. Pair with CSP on the SPA.
 */
import type { CookieOptions, Response } from "express";

export const SESSION_COOKIE_NAME = "vo_session";
export const SESSION_TTL_SEC = 60 * 60 * 24 * 30;

/** HTTPS public URLs need Secure cookies even when NODE_ENV=development (Railway staging). */
export function useSecureCookies(): boolean {
  if (process.env["NODE_ENV"] === "production") return true;
  const base = process.env["APP_BASE_URL"] ?? "";
  return base.startsWith("https://");
}

export function sessionCookieOptions(ttlSec: number = SESSION_TTL_SEC): CookieOptions {
  return {
    httpOnly: true,
    secure: useSecureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: ttlSec * 1000,
  };
}

export function oauthTempCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: useSecureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60 * 1000,
  };
}

export function setSessionCookie(res: Response, token: string, ttlSec: number = SESSION_TTL_SEC): void {
  res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions(ttlSec));
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: useSecureCookies(),
    sameSite: "lax",
    path: "/",
  });
}

export function parseCookieHeader(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key !== name) continue;
    const raw = part.slice(idx + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

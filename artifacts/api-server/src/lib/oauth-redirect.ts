/**
 * Shared Google-OAuth redirect-URI derivation + trusted-origin rules.
 *
 * Both the login flow (routes/auth.ts) and the calendar-connection flow
 * (routes/scheduling/google-oauth.ts) use this single scheme so the same
 * externally-visible host is reflected on both legs of the OAuth handshake
 * (Google requires an exact redirect-URI match).
 */
import type { Request } from "express";
import { getAppDomain, getAppOrigins } from "./app-domain.js";

/**
 * Origin the dashboard is served from (used as a fallback redirect target).
 * When a request is provided, the externally-visible host from
 * x-forwarded-host / x-forwarded-proto is preferred so that the redirect
 * lands on the correct Replit dev-preview domain instead of localhost.
 *
 * Derivation order:
 *   1. APP_BASE_URL env var — explicit production override (e.g. https://app.snapserve.ai)
 *   2. Request's forwarded host (validated against trusted-origin rules)
 *   3. First domain in REPLIT_DOMAINS
 *   4. localhost:80 (last resort)
 */
export function dashboardBase(req?: Request): string {
  if (process.env["APP_BASE_URL"]) {
    return process.env["APP_BASE_URL"].replace(/\/$/, "");
  }
  if (req) {
    const forwardedHost = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim();
    const forwardedProto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? "https";
    const host = forwardedHost ?? req.hostname;
    if (host && isTrustedOrigin(`${forwardedProto}://${host}`)) {
      return `${forwardedProto}://${host}`;
    }
  }
  const domain = getAppDomain();
  if (!domain) return "http://localhost:80";
  const isLocal = domain.startsWith("localhost") || domain.startsWith("127.");
  return isLocal ? `http://${domain}` : `https://${domain}`;
}

/**
 * Allow redirecting back only to origins we trust:
 *   - The explicit APP_BASE_URL origin (e.g. https://app.snapserve.ai)
 *   - Any origin listed in REPLIT_DOMAINS (production + registered dev previews)
 *   - Any *.sisko.replit.dev or *.replit.dev Replit workspace domain (dev previews)
 * Rejects anything else to prevent open-redirect abuse.
 */
export function isTrustedOrigin(origin: string): boolean {
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
 * Derive the OAuth redirect URI from the current request's externally-visible
 * host (honoring the shared proxy's x-forwarded-* headers). The host is
 * validated against the trusted-origin rules before use so an attacker-controlled
 * Host header cannot forge an arbitrary redirect URI.
 *
 * Derivation order (highest priority first):
 *   1. GOOGLE_LOGIN_REDIRECT_URI env var (for login callback path)
 *      GOOGLE_REDIRECT_URI env var (for calendar callback path)
 *      These must be set in production to match the URI registered in Google
 *      Cloud Console. They take priority over all dynamic derivation.
 *   2. Request's forwarded host (externally-visible dev/prod domain) —
 *      convenient fallback in development when no env var is set.
 *   3. First domain in REPLIT_DOMAINS
 *   4. localhost:80 (last resort)
 */
export function deriveRedirectUri(req: Request, callbackPath: string): string {
  // Env-var overrides are always first — ensures exact match with the URI
  // registered in Google Cloud Console regardless of which host the proxy injects.
  if (callbackPath === "/api/auth/google/callback" && process.env["GOOGLE_LOGIN_REDIRECT_URI"]) {
    return process.env["GOOGLE_LOGIN_REDIRECT_URI"];
  }

  if (callbackPath === "/api/scheduling/google/callback" && process.env["GOOGLE_REDIRECT_URI"]) {
    return process.env["GOOGLE_REDIRECT_URI"];
  }

  // Dynamic derivation from the forwarded host (useful in development where
  // the preview domain changes and a fixed URI hasn't been registered).
  const forwardedHost = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim();
  const forwardedProto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? "https";
  const host = forwardedHost ?? req.hostname;

  if (host && isTrustedOrigin(`${forwardedProto}://${host}`)) {
    return `${forwardedProto}://${host}${callbackPath}`;
  }

  const domain = getAppDomain();
  if (!domain) return `http://localhost:80${callbackPath}`;
  const isLocal = domain.startsWith("localhost") || domain.startsWith("127.");
  return isLocal ? `http://${domain}${callbackPath}` : `https://${domain}${callbackPath}`;
}

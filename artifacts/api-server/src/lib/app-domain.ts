/**
 * App-domain helpers — single authoritative place to resolve the
 * public-facing domain / base URL of this API server.
 *
 * Priority (highest → lowest):
 *   1. APP_DOMAIN         — set in local dev (.env) and in Railway service variables
 *   2. REPLIT_DOMAINS     — backward-compat fallback (comma-separated, first entry used)
 *   3. null / localhost   — no public URL configured
 *
 * Local dev (Cursor): set APP_DOMAIN=localhost:8080 in your .env
 * Railway:            set APP_DOMAIN=<your-railway-domain>.up.railway.app
 *
 * REPLIT_DOMAINS is kept as a fallback so existing Railway deployments that
 * already have it set continue to work without any Railway env-var changes.
 */

/** Raw domain string (no protocol, no trailing slash), or null if unconfigured. */
export function getAppDomain(): string | null {
  const appDomain = process.env["APP_DOMAIN"];
  if (appDomain) return appDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const replitDomains = process.env["REPLIT_DOMAINS"];
  if (replitDomains) return replitDomains.split(",")[0]?.trim() ?? null;
  return null;
}

/**
 * Full base URL for the API server.
 * Used for self-referencing webhook/callback URLs (Twilio, Plivo, VoBiz, etc.).
 * Falls back to http://localhost:{PORT} when no domain is configured.
 */
export function getSelfBaseUrl(): string {
  const domain = getAppDomain();
  if (!domain) return `http://localhost:${process.env["PORT"] ?? "8080"}`;
  const isLocal = domain.startsWith("localhost") || domain.startsWith("127.");
  return isLocal ? `http://${domain}` : `https://${domain}`;
}

/**
 * All trusted origins (for CORS and OAuth redirect-back validation).
 * Includes APP_BASE_URL (dashboard URL), APP_DOMAIN (API), and REPLIT_DOMAINS (compat).
 */
export function getAppOrigins(): string[] {
  const origins: string[] = [];
  const appBaseUrl = process.env["APP_BASE_URL"]?.replace(/\/$/, "");
  if (appBaseUrl) origins.push(appBaseUrl);
  const appDomain = process.env["APP_DOMAIN"]?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (appDomain) {
    const isLocal = appDomain.startsWith("localhost") || appDomain.startsWith("127.");
    origins.push(isLocal ? `http://${appDomain}` : `https://${appDomain}`);
  }
  for (const d of (process.env["REPLIT_DOMAINS"] ?? "").split(",")) {
    const trimmed = d.trim();
    if (trimmed) origins.push(`https://${trimmed}`);
  }
  return [...new Set(origins)];
}

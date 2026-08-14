/**
 * Pure partner-domain helpers (no DB) — used by partner-domains.ts and unit tests.
 */
export const RESERVED_SLUGS = new Set([
  "www", "app", "api", "admin", "mail", "smtp", "ftp", "cdn", "static",
  "status", "docs", "help", "support", "billing", "pay", "webhook", "webhooks",
  "partner", "partners", "auth", "login", "signup", "oauth", "mcp", "dev",
  "staging", "prod", "production", "test", "demo", "null", "undefined",
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export type CustomDomainStatus = "none" | "pending" | "active" | "failed";

/** Root used for partner subdomains — default snapserve.ai → acme.snapserve.ai */
export function getPartnerSubdomainRoot(): string {
  const env = (process.env["PARTNER_SUBDOMAIN_ROOT"] ?? "").trim().toLowerCase();
  if (env) return env.replace(/^\.+/, "").replace(/\.+$/, "");
  const base = (process.env["APP_BASE_URL"] ?? "").trim();
  if (base) {
    try {
      const host = new URL(base).hostname.toLowerCase();
      const parts = host.split(".");
      if (parts.length >= 2) return parts.slice(-2).join(".");
    } catch { /* ignore */ }
  }
  return "snapserve.ai";
}

/** Host partners should CNAME their custom domain to. */
export function getPartnerCnameTarget(): string {
  const env = (process.env["PARTNER_CNAME_TARGET"] ?? "").trim().toLowerCase();
  if (env) return env.replace(/^\.+/, "").replace(/\.+$/, "");
  return `partners.${getPartnerSubdomainRoot()}`;
}

export function normalizeSlug(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function validateSlug(slug: string): string | null {
  if (!slug) return "Slug is required";
  if (slug.length < 2) return "Slug must be at least 2 characters";
  if (!SLUG_RE.test(slug)) return "Slug may only use lowercase letters, numbers, and hyphens";
  if (RESERVED_SLUGS.has(slug)) return "That slug is reserved";
  return null;
}

export function normalizeDomain(raw: string): string {
  let d = String(raw ?? "").trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
  if (d.startsWith("www.")) d = d.slice(4);
  return d;
}

export function validateDomain(domain: string): string | null {
  if (!domain) return "Domain is required";
  if (domain.length > 253) return "Domain is too long";
  if (!DOMAIN_RE.test(domain)) return "Enter a valid domain like app.yourbrand.com";
  const root = getPartnerSubdomainRoot();
  if (domain === root || domain.endsWith(`.${root}`)) {
    return `Use the subdomain slug for *.${root} — custom domain is for your own brand`;
  }
  return null;
}

export function subdomainHostForSlug(slug: string): string {
  return `${slug}.${getPartnerSubdomainRoot()}`;
}

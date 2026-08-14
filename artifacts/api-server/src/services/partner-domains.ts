/**
 * Partner white-label domains.
 *
 * Phase A — subdomain:  {slug}.{PARTNER_SUBDOMAIN_ROOT}  e.g. acme.snapserve.ai
 * Phase B — custom:     partner CNAME → partners.snapserve.ai (or APP host),
 *                       verified via TXT record snapserve-verify={token}
 */
import { createHash, randomBytes } from "node:crypto";
import { resolveCname, resolveTxt } from "node:dns/promises";
import { and, eq, or } from "drizzle-orm";
import { db, partnersTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import {
  getPartnerCnameTarget,
  getPartnerSubdomainRoot,
  normalizeDomain,
  subdomainHostForSlug,
  type CustomDomainStatus,
} from "./partner-domains-normalize.js";

export {
  getPartnerCnameTarget,
  getPartnerSubdomainRoot,
  normalizeDomain,
  normalizeSlug,
  subdomainHostForSlug,
  validateDomain,
  validateSlug,
  type CustomDomainStatus,
} from "./partner-domains-normalize.js";

export interface PartnerBrandPublic {
  partnerId: number;
  companyName: string;
  logoUrl: string | null;
  loginTitle: string | null;
  loginSubtitle: string | null;
  /** Partner white-label hosts always use email/password (no Google). */
  authMode: "password";
  slug: string | null;
  subdomainHost: string | null;
  customDomain: string | null;
  customDomainStatus: CustomDomainStatus;
}

export function newDomainVerifyToken(): string {
  return randomBytes(16).toString("hex");
}

function logoUrlFor(token: string | null): string | null {
  return token ? `/api/public/partner-logos/${token}` : null;
}

function toBrand(row: {
  id: number;
  companyName: string;
  logoToken: string | null;
  loginTitle: string | null;
  loginSubtitle: string | null;
  slug: string | null;
  customDomain: string | null;
  customDomainStatus: string | null;
}): PartnerBrandPublic {
  const status = (row.customDomainStatus ?? "none") as CustomDomainStatus;
  return {
    partnerId: row.id,
    companyName: row.companyName,
    logoUrl: logoUrlFor(row.logoToken),
    loginTitle: row.loginTitle,
    loginSubtitle: row.loginSubtitle,
    authMode: "password",
    slug: row.slug,
    subdomainHost: row.slug ? subdomainHostForSlug(row.slug) : null,
    customDomain: row.customDomain,
    customDomainStatus: status,
  };
}

export async function resolvePartnerByHost(rawHost: string): Promise<PartnerBrandPublic | null> {
  const host = normalizeDomain(rawHost);
  if (!host) return null;

  const root = getPartnerSubdomainRoot();
  if (host.endsWith(`.${root}`) && host !== `www.${root}` && host !== `app.${root}` && host !== `api.${root}`) {
    const slug = host.slice(0, -(root.length + 1));
    if (slug && !slug.includes(".")) {
      const [row] = await db
        .select({
          id: partnersTable.id,
          companyName: partnersTable.companyName,
          logoToken: partnersTable.logoToken,
          loginTitle: partnersTable.loginTitle,
          loginSubtitle: partnersTable.loginSubtitle,
          slug: partnersTable.slug,
          customDomain: partnersTable.customDomain,
          customDomainStatus: partnersTable.customDomainStatus,
          status: partnersTable.status,
        })
        .from(partnersTable)
        .where(and(eq(partnersTable.slug, slug), eq(partnersTable.status, "active")))
        .limit(1);
      if (row) return toBrand(row);
    }
  }

  const [byCustom] = await db
    .select({
      id: partnersTable.id,
      companyName: partnersTable.companyName,
      logoToken: partnersTable.logoToken,
      loginTitle: partnersTable.loginTitle,
      loginSubtitle: partnersTable.loginSubtitle,
      slug: partnersTable.slug,
      customDomain: partnersTable.customDomain,
      customDomainStatus: partnersTable.customDomainStatus,
      status: partnersTable.status,
    })
    .from(partnersTable)
    .where(
      and(
        eq(partnersTable.customDomain, host),
        eq(partnersTable.status, "active"),
        or(
          eq(partnersTable.customDomainStatus, "active"),
          eq(partnersTable.customDomainStatus, "pending"),
        ),
      ),
    )
    .limit(1);
  if (byCustom) return toBrand(byCustom);
  return null;
}

export async function listTrustedPartnerHosts(): Promise<string[]> {
  const root = getPartnerSubdomainRoot();
  const rows = await db
    .select({
      slug: partnersTable.slug,
      customDomain: partnersTable.customDomain,
      customDomainStatus: partnersTable.customDomainStatus,
    })
    .from(partnersTable)
    .where(eq(partnersTable.status, "active"));

  const hosts: string[] = [];
  for (const r of rows) {
    if (r.slug) hosts.push(`${r.slug}.${root}`);
    if (r.customDomain && r.customDomainStatus === "active") hosts.push(r.customDomain);
  }
  return hosts;
}

let hostCache: { at: number; hosts: Set<string> } = { at: 0, hosts: new Set() };
const HOST_CACHE_TTL_MS = 60_000;

export async function refreshPartnerHostCache(): Promise<Set<string>> {
  try {
    const hosts = await listTrustedPartnerHosts();
    hostCache = { at: Date.now(), hosts: new Set(hosts) };
  } catch (err) {
    logger.warn({ err }, "partner-domains: host cache refresh failed");
  }
  return hostCache.hosts;
}

export function isCachedPartnerHost(host: string): boolean {
  const h = normalizeDomain(host);
  if (!h) return false;
  if (Date.now() - hostCache.at > HOST_CACHE_TTL_MS) {
    void refreshPartnerHostCache();
  }
  return hostCache.hosts.has(h);
}

export function invalidatePartnerHostCache(): void {
  hostCache.at = 0;
  void refreshPartnerHostCache();
}

export async function verifyCustomDomainDns(opts: {
  domain: string;
  verifyToken: string;
}): Promise<{ ok: boolean; reason?: string; cname?: string[]; txt?: string[] }> {
  const domain = normalizeDomain(opts.domain);
  const target = getPartnerCnameTarget();
  let cname: string[] = [];
  let txt: string[] = [];

  try {
    cname = await resolveCname(domain);
  } catch {
    // apex may be A/ALIAS — still allow TXT verify
  }
  try {
    const records = await resolveTxt(`_snapserve-verify.${domain}`);
    txt = records.map((parts: string[]) => parts.join(""));
  } catch {
    try {
      const records = await resolveTxt(domain);
      txt = records.map((parts: string[]) => parts.join(""));
    } catch { /* none */ }
  }

  const cnameOk = cname.some((c) => normalizeDomain(c) === target || normalizeDomain(c).endsWith(`.${getPartnerSubdomainRoot()}`));
  const expected = `snapserve-verify=${opts.verifyToken}`;
  const txtOk = txt.some((t) => t.trim() === expected || t.includes(opts.verifyToken));

  if (cnameOk || txtOk) return { ok: true, cname, txt };
  return {
    ok: false,
    reason: `DNS not ready. Add CNAME ${domain} → ${target} (or TXT _snapserve-verify.${domain} = ${expected})`,
    cname,
    txt,
  };
}

export function hashDomainToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

/**
 * Partner white-label portal access control.
 *
 * Managed clients may sign in only on their partner's portal host.
 * Partner owners and direct SnapServe users use app.snapserve.ai.
 * Cross-tenant sign-in is rejected at login and on every authenticated request.
 */
import type { Request } from "express";
import { db, partnersTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  normalizeDomain,
  resolvePartnerByHost,
  subdomainHostForSlug,
  type PartnerBrandPublic,
} from "../services/partner-domains.js";

/** Hosts where the main SnapServe dashboard lives (not a partner portal). */
export function isDirectSnapServeHost(hostname: string): boolean {
  const h = normalizeDomain(hostname);
  if (!h) return true;
  if (h === "app.snapserve.ai" || h === "www.snapserve.ai" || h === "snapserve.ai") return true;
  if (h === "localhost" || h === "127.0.0.1" || h.endsWith(".localhost")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return true;
  return false;
}

export function primaryRequestHost(req: Request, bodyHost?: string): string {
  return partnerHostCandidates(req, bodyHost)[0] ?? "";
}

/** Server-trusted host first; optional body host is a fallback only. */
export function partnerHostCandidates(req: Request, bodyHost?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const host = normalizeDomain(raw);
    if (!host || seen.has(host)) return;
    seen.add(host);
    out.push(host);
  };
  push((req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() ?? "");
  push(req.hostname ?? "");
  if (typeof bodyHost === "string") push(bodyHost);
  return out;
}

export async function resolvePartnerHostFromRequest(
  req: Request,
  bodyHost?: string,
): Promise<PartnerBrandPublic | null> {
  for (const host of partnerHostCandidates(req, bodyHost)) {
    const brand = await resolvePartnerByHost(host);
    if (brand) return brand;
  }
  return null;
}

export async function userMayAccessPartnerPortal(
  clerkId: string,
  partnerId: number,
): Promise<boolean> {
  const [owner] = await db
    .select({ userId: partnersTable.userId })
    .from(partnersTable)
    .where(eq(partnersTable.id, partnerId))
    .limit(1);
  if (owner?.userId === clerkId) return true;

  const [user] = await db
    .select({ partnerId: usersTable.partnerId })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId))
    .limit(1);
  return user?.partnerId === partnerId;
}

export function partnerPortalLoginUrl(partner: {
  slug: string | null;
  customDomain: string | null;
  customDomainStatus: string | null;
}): string {
  if (partner.customDomain && partner.customDomainStatus === "active") {
    return `https://${partner.customDomain}`;
  }
  if (partner.slug) {
    return `https://${subdomainHostForSlug(partner.slug)}`;
  }
  const base = (process.env["APP_BASE_URL"] ?? "https://app.snapserve.ai").replace(/\/$/, "");
  return base;
}

export function managedClientSnapServeDeniedMessage(companyName: string, loginBase: string): string {
  return `This account is managed by ${companyName}. Sign in at ${loginBase}/sign-in.`;
}

export function partnerPortalDeniedMessage(companyName: string): string {
  return `This account is not registered with ${companyName}.`;
}

export async function assertUserMayAccessPartnerPortal(
  clerkId: string,
  partnerBrand: PartnerBrandPublic,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const allowed = await userMayAccessPartnerPortal(clerkId, partnerBrand.partnerId);
  if (allowed) return { ok: true };
  return { ok: false, error: partnerPortalDeniedMessage(partnerBrand.companyName) };
}

/** Enforce host ↔ account pairing for login and active sessions. */
export async function assertLoginHostAllowed(
  clerkId: string,
  partnerBrand: PartnerBrandPublic | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (partnerBrand) {
    return assertUserMayAccessPartnerPortal(clerkId, partnerBrand);
  }

  const [user] = await db
    .select({ partnerId: usersTable.partnerId })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId))
    .limit(1);

  if (!user?.partnerId) return { ok: true };

  const [partner] = await db
    .select({
      companyName: partnersTable.companyName,
      slug: partnersTable.slug,
      customDomain: partnersTable.customDomain,
      customDomainStatus: partnersTable.customDomainStatus,
    })
    .from(partnersTable)
    .where(eq(partnersTable.id, user.partnerId))
    .limit(1);

  const companyName = partner?.companyName ?? "your company";
  const loginBase = partner ? partnerPortalLoginUrl(partner) : partnerPortalLoginUrl({
    slug: null,
    customDomain: null,
    customDomainStatus: null,
  });
  return {
    ok: false,
    error: managedClientSnapServeDeniedMessage(companyName, loginBase),
  };
}

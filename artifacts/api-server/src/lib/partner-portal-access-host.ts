/**
 * Pure partner-host helpers (no DB) — used by partner-portal-access and unit tests.
 */
import { normalizeDomain } from "../services/partner-domains-normalize.js";

/** Hosts where the main SnapServe dashboard lives (not a partner portal). */
export function isDirectSnapServeHost(hostname: string): boolean {
  const h = normalizeDomain(hostname);
  if (!h) return true;
  if (h === "app.snapserve.ai" || h === "www.snapserve.ai" || h === "snapserve.ai") return true;
  if (h === "localhost" || h === "127.0.0.1" || h.endsWith(".localhost")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return true;
  return false;
}

/** Minimal request shape for host resolution (tests + Express Request). */
export type PartnerHostRequest = {
  headers: { "x-forwarded-host"?: string | string[]; [key: string]: unknown };
  hostname?: string;
};

export function primaryRequestHost(req: PartnerHostRequest, bodyHost?: string): string {
  return partnerHostCandidates(req, bodyHost)[0] ?? "";
}

/** Server-trusted host first; optional body host is a fallback only. */
export function partnerHostCandidates(req: PartnerHostRequest, bodyHost?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const host = normalizeDomain(raw);
    if (!host || seen.has(host)) return;
    seen.add(host);
    out.push(host);
  };
  const forwarded = req.headers["x-forwarded-host"];
  const forwardedHost = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  push(typeof forwardedHost === "string" ? forwardedHost.split(",")[0]?.trim() ?? "" : "");
  push(req.hostname ?? "");
  if (typeof bodyHost === "string") push(bodyHost);
  return out;
}

export function partnerPortalDeniedMessage(companyName: string): string {
  return `This account is not registered with ${companyName}.`;
}

export function managedClientSnapServeDeniedMessage(companyName: string, loginBase: string): string {
  return `This account is managed by ${companyName}. Sign in at ${loginBase}/sign-in.`;
}

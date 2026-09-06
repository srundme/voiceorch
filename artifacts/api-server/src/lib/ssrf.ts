/**
 * SSRF guard for user-configured outbound URLs (agent webhook tools, WhatsApp
 * BYO webhooks, workspace webhook endpoints, journey send_webhook, campaign
 * after-call / lead-transfer URLs).
 *
 * Deny private/loopback/link-local IPs and cloud-metadata hostnames, and
 * re-validate every redirect hop so a public CNAME cannot bounce into RFC1918.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.google.com",
  "metadata",
  "instance-data",
]);

const BLOCKED_HOST_SUFFIXES = [".localhost", ".internal", ".local", ".lan"];

export function isPrivateIp(ip: string): boolean {
  const v = ip.trim().toLowerCase();
  if (!v) return true;
  if (v === "::1" || v === "0:0:0:0:0:0:0:1") return true;
  if (v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd")) return true;
  const mapped = v.startsWith("::ffff:") ? v.slice(7) : v;
  const parts = mapped.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number];
  return (
    a === 127
    || a === 10
    || a === 0
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
    || (a === 100 && b >= 64 && b <= 127) // CGNAT
  );
}

export function isBlockedWebhookHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (BLOCKED_HOSTS.has(host)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) return true;
  const ip = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (isIP(ip)) return isPrivateIp(ip);
  return false;
}

/** Sync URL shape check (protocol + host). DNS is checked at fetch time. */
export function assertSafeWebhookUrlShape(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid webhook URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("Webhook URL must be http or https");
  }
  if (u.username || u.password) {
    throw new Error("Webhook URL must not include credentials");
  }
  if (isBlockedWebhookHostname(u.hostname)) {
    throw new Error("Webhook URL host is not allowed");
  }
  return u;
}

export async function assertSafeWebhookUrl(raw: string): Promise<URL> {
  const u = assertSafeWebhookUrlShape(raw);
  const host = u.hostname.startsWith("[") && u.hostname.endsWith("]")
    ? u.hostname.slice(1, -1)
    : u.hostname;
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error("Webhook URL host is not allowed");
    return u;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch (err) {
    throw new Error(`Webhook URL DNS lookup failed: ${(err as Error).message}`);
  }
  if (addresses.length === 0) throw new Error("Webhook URL DNS lookup returned no addresses");
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new Error(`Webhook URL resolves to a private address (${address})`);
    }
  }
  return u;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || /aborted/i.test(err.message));
}

const SAFE_FETCH_MAX_REDIRECTS = 4;

async function fetchHop(
  url: string,
  init: RequestInit,
  hopsLeft: number,
): Promise<Response> {
  await assertSafeWebhookUrl(url);
  const res = await fetch(url, { ...init, redirect: "manual" });
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    if (!location || hopsLeft <= 0) {
      throw new Error("Webhook redirect limit exceeded");
    }
    const next = new URL(location, url).href;
    return fetchHop(next, init, hopsLeft - 1);
  }
  return res;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch a user-configured URL with SSRF checks on every hop.
 * Optional retries cover 408/429/5xx and network failures (not 4xx).
 */
export async function fetchUserConfiguredUrl(
  rawUrl: string,
  init: RequestInit = {},
  opts?: { timeoutMs?: number; retries?: number },
): Promise<Response> {
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const retries = Math.max(0, opts?.retries ?? 0);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await sleep(Math.min(2_000, 250 * 2 ** (attempt - 1)));
    }
    try {
      const signal = init.signal ?? AbortSignal.timeout(timeoutMs);
      const resp = await fetchHop(rawUrl, { ...init, signal }, SAFE_FETCH_MAX_REDIRECTS);
      if (resp.ok || !isRetryableStatus(resp.status) || attempt === retries) return resp;
      lastErr = new Error(`HTTP ${resp.status}`);
    } catch (err) {
      lastErr = err;
      if (isAbort(err) || attempt === retries) throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

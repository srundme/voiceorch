export const BASE = "/api/admin";

export async function adminFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = localStorage.getItem("adminToken") ?? "";
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 
      "Content-Type": "application/json", 
      "X-Admin-Token": token, 
      ...opts?.headers 
    },
  });
  
  if (res.status === 403 || res.status === 401) {
    localStorage.removeItem("adminToken");
    window.location.href = `${import.meta.env.BASE_URL}login`;
    throw new Error("Unauthorized");
  }
  
  if (!res.ok) {
    const errorText = (await res.text().catch(() => "")).trim();
    throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
  }

  // 204 No Content (or empty body) — common for DELETE/PUT — has no JSON to parse.
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/**
 * Extracts a user-readable message from any value thrown by adminFetch or
 * mutation handlers.
 *
 * Priority:
 *  1. err.message — the HTTP status + body text built by adminFetch, or a
 *     network-level message from a TypeError thrown by fetch itself
 *  2. Generic fallback for all other thrown values (null, undefined, strings, …)
 */
export function formatAdminError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred.";
}

/** Format wallet/ledger minor units (paise) as INR. Name kept for call-site compat. */
export function formatCentsToDollars(cents: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(cents / 100);
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

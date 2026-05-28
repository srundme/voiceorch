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
    const errorText = await res.text().catch(() => "");
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

export function formatCentsToDollars(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

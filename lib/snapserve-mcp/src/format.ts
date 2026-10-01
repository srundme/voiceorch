import { SnapServeApiError } from "./client.js";

/** Tool results above this size are cut so one response cannot flood the model's context. */
const MAX_RESULT_CHARS = 60_000;

/** Keys whose values are credentials. `token` / `webhookToken` are intentionally absent: they are join/intake handles the user needs. */
const SECRET_KEYS = new Set([
  "apikey",
  "api_key",
  "secret",
  "webhooksecret",
  "clientsecret",
  "password",
  "authorization",
  "accesstoken",
  "refreshtoken",
  "metaaccesstoken",
  "metapageaccesstoken",
  "brevoapikey",
  "orgkey",
]);

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
};

export function maskSecret(value: string): string {
  if (value.length <= 12) return "••••";
  return `••••${value.slice(-4)}`;
}

/** Deep-copy `data` with credential-looking fields masked. */
export function redact(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(redact);
  if (!data || typeof data !== "object") return data;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (SECRET_KEYS.has(key.toLowerCase()) && typeof value === "string" && value) {
      out[key] = maskSecret(value);
    } else {
      out[key] = redact(value);
    }
  }
  return out;
}

export function ok(data: unknown): ToolResult {
  const payload = data === undefined || data === null || data === "" ? { ok: true } : redact(data);
  let text = typeof payload === "string" ? payload : JSON.stringify(payload);
  if (text.length > MAX_RESULT_CHARS) {
    text =
      `${text.slice(0, MAX_RESULT_CHARS)}\n…[truncated ${text.length - MAX_RESULT_CHARS} chars — ` +
      "narrow the request with filters / limit, or fetch one item by id]";
  }
  return { content: [{ type: "text", text }] };
}

export function fail(err: unknown): ToolResult {
  if (err instanceof SnapServeApiError) {
    const hint =
      err.status === 401
        ? " — the SnapServe API key is invalid or revoked; reconnect with a new key"
        : err.status === 403
          ? " — this key's workspace does not have permission for that resource"
          : err.status === 404
            ? " — not found in this workspace (check the id with a list_* tool)"
            : "";
    return {
      content: [{
        type: "text",
        text: JSON.stringify(redact({ error: `${err.message}${hint}`, status: err.status, details: err.body })),
      }],
      isError: true,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: message }], isError: true };
}

export async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

export function pick<T extends Record<string, unknown>>(row: T, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null) out[k] = row[k];
  }
  return out;
}

export function truncateText(value: unknown, max: number): unknown {
  if (typeof value !== "string" || value.length <= max) return value;
  return `${value.slice(0, max)}…[+${value.length - max} chars]`;
}

export function asArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    for (const key of ["items", "data", "rows", "results"]) {
      const v = (data as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
  }
  return [];
}

/** Return the first `limit` rows plus paging info, so the model knows more exist. */
export function page<T>(rows: T[], limit: number, offset = 0): { total: number; returned: number; offset: number; items: T[] } {
  const items = rows.slice(offset, offset + limit);
  return { total: rows.length, returned: items.length, offset, items };
}

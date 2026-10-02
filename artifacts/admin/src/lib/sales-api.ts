export const SALES_BASE = "/api/sales";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type SalesErrorBody = {
  error?: string;
  errors?: string[];
  details?: { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> };
  code?: string;
  [key: string]: unknown;
};

export class SalesApiError extends Error {
  readonly status: number;
  readonly body: SalesErrorBody | null;

  constructor(status: number, body: SalesErrorBody | null, fallback: string) {
    super(body?.error || fallback);
    this.name = "SalesApiError";
    this.status = status;
    this.body = body;
  }

  /** Every server-side validation message, verbatim, in display order. */
  get messages(): string[] {
    const out: string[] = [];
    if (this.body?.errors?.length) out.push(...this.body.errors);
    else if (this.message) out.push(this.message);
    const details = this.body?.details;
    if (details) {
      for (const m of details.formErrors ?? []) out.push(m);
      for (const [field, msgs] of Object.entries(details.fieldErrors ?? {})) {
        for (const m of msgs ?? []) out.push(`${field}: ${m}`);
      }
    }
    return out;
  }
}

export function isSalesApiError(err: unknown): err is SalesApiError {
  return err instanceof SalesApiError;
}

export function salesErrorMessages(err: unknown): string[] {
  if (err instanceof SalesApiError) return err.messages;
  if (err instanceof Error) return [err.message];
  return ["Something went wrong."];
}

export function salesErrorText(err: unknown): string {
  return salesErrorMessages(err).join("; ");
}

export type SalesQuery = Record<string, string | number | boolean | null | undefined>;

export function salesQueryString(query?: SalesQuery): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    params.set(k, v === true ? "1" : String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function salesRequestHeaders(method: string, hasBody: boolean, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (hasBody && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!SAFE_METHODS.has(method.toUpperCase())) headers.set("X-Sales-Request", "1");
  return headers;
}

const UNAUTHORIZED_EXEMPT = ["/auth/login", "/auth/logout", "/invites/"];

function notifyUnauthorized(path: string) {
  if (UNAUTHORIZED_EXEMPT.some((p) => path.startsWith(p))) return;
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(new CustomEvent("sales:unauthorized"));
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  return text;
}

export type SalesFetchOptions = Omit<RequestInit, "body"> & { body?: unknown; query?: SalesQuery };

/** JSON client for /api/sales. Sends the session cookie and the CSRF header on every write. */
export async function salesFetch<T>(path: string, opts: SalesFetchOptions = {}): Promise<T> {
  const { body, query, headers, method: rawMethod, ...rest } = opts;
  const method = (rawMethod ?? (body !== undefined ? "POST" : "GET")).toUpperCase();
  const hasBody = body !== undefined;
  const res = await fetch(`${SALES_BASE}${path}${salesQueryString(query)}`, {
    ...rest,
    method,
    credentials: "same-origin",
    headers: salesRequestHeaders(method, hasBody, headers),
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  const parsed = await readBody(res);
  if (!res.ok) {
    if (res.status === 401) notifyUnauthorized(path);
    const errBody = parsed && typeof parsed === "object" ? (parsed as SalesErrorBody) : typeof parsed === "string" ? { error: parsed } : null;
    throw new SalesApiError(res.status, errBody, `HTTP ${res.status}${res.statusText ? `: ${res.statusText}` : ""}`);
  }
  return parsed as T;
}

/** Downloads a CSV export through fetch so the cookie and errors are handled like any other call. */
export async function salesDownload(path: string, filename: string, query?: SalesQuery): Promise<void> {
  const res = await fetch(`${SALES_BASE}${path}${salesQueryString(query)}`, {
    credentials: "same-origin",
    headers: salesRequestHeaders("GET", false, { Accept: "text/csv" }),
  });
  if (!res.ok) {
    const parsed = await readBody(res);
    if (res.status === 401) notifyUnauthorized(path);
    throw new SalesApiError(res.status, parsed && typeof parsed === "object" ? (parsed as SalesErrorBody) : null, `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Absolute URL for a path inside the admin SPA (respects the Vite base, e.g. /admin-ui/). */
export function adminAppUrl(path: string): string {
  const base = (import.meta.env?.BASE_URL ?? "/").replace(/\/$/, "");
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${base}${path.startsWith("/") ? path : `/${path}`}`;
}

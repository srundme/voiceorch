export interface SnapServeClientOptions {
  /** Your SnapServe API key, e.g. "sk_live_...". Create one in Dashboard → API Keys. */
  apiKey: string;
  /** Override the API base URL. Defaults to the hosted SnapServe API. */
  baseUrl?: string;
  /** Optional fetch implementation override (mainly for testing). */
  fetch?: typeof fetch;
}

export class SnapServeApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "SnapServeApiError";
    this.status = status;
    this.body = body;
  }
}

const DEFAULT_BASE_URL = "https://app.snapserve.ai/api";

export class SnapServeHttp {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SnapServeClientOptions) {
    if (!options.apiKey) {
      throw new Error("SnapServe SDK: apiKey is required");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  /**
   * Low-level escape hatch: call any SnapServe API endpoint directly, including
   * ones this SDK doesn't have a typed helper for yet.
   */
  async request<T = unknown>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    options: { body?: unknown; query?: Record<string, string | number | boolean | undefined | null> } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + (path.startsWith("/") ? path : `/${path}`));
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const res = await this.fetchImpl(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const text = await res.text();
    const data: unknown = text ? safeJsonParse(text) : undefined;

    if (!res.ok) {
      const message =
        (data && typeof data === "object" && "error" in data && typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : undefined) ?? `SnapServe API request failed with status ${res.status}`;
      throw new SnapServeApiError(res.status, message, data);
    }

    return data as T;
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

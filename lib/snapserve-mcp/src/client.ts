export interface SnapServeClientOptions {
  apiKey: string;
  baseUrl?: string;
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

export class SnapServeClient {
  private readonly apiKey: string;
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SnapServeClientOptions) {
    if (!options.apiKey?.trim()) {
      throw new Error("SNAPSERVE_API_KEY is required (Dashboard → API Keys → sk_live_...)");
    }
    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  async request<T = unknown>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    options: {
      body?: unknown;
      query?: Record<string, string | number | boolean | undefined | null>;
    } = {},
  ): Promise<T> {
    if (/:\/\/|\.\./.test(path)) {
      throw new Error("path must be a relative SnapServe API path like /agents/123");
    }
    const url = new URL(this.baseUrl + (path.startsWith("/") ? path : `/${path}`));
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const res = await this.fetchImpl(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
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
          : undefined) ?? `SnapServe API ${method} ${path} failed (${res.status})`;
      throw new SnapServeApiError(res.status, message, data);
    }

    return data as T;
  }

  /** Public website lead intake URL for a campaign webhook token. */
  websiteLeadUrl(webhookToken: string): string {
    return `${this.baseUrl}/webhooks/lead/${webhookToken}`;
  }

  /** Dashboard origin (base URL without the trailing /api). */
  get appOrigin(): string {
    return this.baseUrl.replace(/\/api$/, "");
  }

  webcallJoinUrl(token: string): string {
    return `${this.appOrigin}/join/${token}`;
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

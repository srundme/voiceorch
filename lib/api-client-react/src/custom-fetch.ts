export type CustomFetchOptions = RequestInit & {
  responseType?: "json" | "text" | "blob" | "auto";
  /**
   * Abort the request after this many milliseconds and throw a
   * `RequestTimeoutError`.  Defaults to 30 000 ms (30 s).
   * Pass `0` or `Infinity` to disable the timeout.
   */
  timeoutMs?: number;
};

export type ErrorType<T = unknown> = ApiError<T>;

export type BodyType<T> = T;

export type AuthTokenGetter = () => Promise<string | null> | string | null;

export type UnauthorizedHandler = (error: ApiError) => void;

const NO_BODY_STATUS = new Set([204, 205, 304]);
const DEFAULT_JSON_ACCEPT = "application/json, application/problem+json";
const DEFAULT_TIMEOUT_MS = 30_000;

export class RequestTimeoutError extends Error {
  readonly name = "TimeoutError";

  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs} ms — please try again`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Module-level configuration
// ---------------------------------------------------------------------------

let _baseUrl: string | null = null;
let _authTokenGetter: AuthTokenGetter | null = null;
let _defaultTimeoutMs: number = DEFAULT_TIMEOUT_MS;
let _unauthorizedHandler: UnauthorizedHandler | null = null;
let _clientContext: string | null = null;

/**
 * Partner "acting as client" mode: when set, every request carries an
 * `x-client-context: <client user id>` header. The server validates that the
 * caller is an active partner managing that client and then executes the
 * request against the client's account.
 *
 * IMPORTANT: callers must clear/refetch any client-side query cache when
 * toggling this — cached responses do not key on the header.
 * Pass `null` to exit acting-as mode.
 */
export function setClientContext(clientUserId: string | null): void {
  _clientContext = clientUserId;
}

export function getClientContext(): string | null {
  return _clientContext;
}

/**
 * Set a base URL that is prepended to every relative request URL
 * (i.e. paths that start with `/`).
 *
 * Useful for Expo bundles that need to call a remote API server.
 * Pass `null` to clear the base URL.
 */
export function setBaseUrl(url: string | null): void {
  _baseUrl = url ? url.replace(/\/+$/, "") : null;
}

/**
 * Register a getter that supplies a bearer auth token.  Before every fetch
 * the getter is invoked; when it returns a non-null string, an
 * `Authorization: Bearer <token>` header is attached to the request.
 *
 * Useful for Expo bundles making token-gated API calls.
 * Pass `null` to clear the getter.
 *
 * NOTE: This function should never be used in web applications where session
 * token cookies are automatically associated with API calls by the browser.
 */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  _authTokenGetter = getter;
}

/**
 * Override the default timeout applied to every request that does not
 * supply an explicit `timeoutMs` option.
 *
 * - Pass a positive finite number (milliseconds) to set a custom default.
 * - Pass `0` or `Infinity` to disable the timeout globally.
 * - The built-in default is 30 000 ms (30 s).
 */
export function setDefaultTimeoutMs(ms: number): void {
  _defaultTimeoutMs = ms;
}

/**
 * Register a handler invoked whenever ANY request receives a 401 response.
 *
 * This exists because a client can hold a locally valid (non-expired) JWT
 * while the server-side account has since been suspended/deleted — the
 * client has no other way to learn its session was revoked except by
 * observing a 401 on a live API call. Wire this up to clear the stored
 * session and redirect to sign-in.
 *
 * Pass `null` to clear the handler.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  _unauthorizedHandler = handler;
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function resolveMethod(input: RequestInfo | URL, explicitMethod?: string): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (isRequest(input)) return input.method.toUpperCase();
  return "GET";
}

// Use loose check for URL — some runtimes (e.g. React Native) polyfill URL
// differently, so `instanceof URL` can fail.
function isUrl(input: RequestInfo | URL): input is URL {
  return typeof URL !== "undefined" && input instanceof URL;
}

function applyBaseUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!_baseUrl) return input;
  const url = resolveUrl(input);
  // Only prepend to relative paths (starting with /)
  if (!url.startsWith("/")) return input;

  const absolute = `${_baseUrl}${url}`;
  if (typeof input === "string") return absolute;
  if (isUrl(input)) return new URL(absolute);
  return new Request(absolute, input as Request);
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (isUrl(input)) return input.toString();
  return input.url;
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

function getMediaType(headers: Headers): string | null {
  const value = headers.get("content-type");
  return value ? value.split(";", 1)[0].trim().toLowerCase() : null;
}

function isJsonMediaType(mediaType: string | null): boolean {
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}

function isTextMediaType(mediaType: string | null): boolean {
  return Boolean(
    mediaType &&
      (mediaType.startsWith("text/") ||
        mediaType === "application/xml" ||
        mediaType === "text/xml" ||
        mediaType.endsWith("+xml") ||
        mediaType === "application/x-www-form-urlencoded"),
  );
}

// Use strict equality: in browsers, `response.body` is `null` when the
// response genuinely has no content.  In React Native, `response.body` is
// always `undefined` because the ReadableStream API is not implemented —
// even when the response carries a full payload readable via `.text()` or
// `.json()`.  Loose equality (`== null`) matches both `null` and `undefined`,
// which causes every React Native response to be treated as empty.
function hasNoBody(response: Response, method: string): boolean {
  if (method === "HEAD") return true;
  if (NO_BODY_STATUS.has(response.status)) return true;
  if (response.headers.get("content-length") === "0") return true;
  if (response.body === null) return true;
  return false;
}

/**
 * Combine two AbortSignals so that aborting either one aborts the merged
 * signal.  Uses `AbortSignal.any` when available (Node 20+, modern browsers)
 * and falls back to a manual event-listener approach for older runtimes such
 * as React Native.
 */
function mergeAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([a, b]);
  }

  // Fallback: forward the first abort to a new controller.
  const controller = new AbortController();

  function forward(this: AbortSignal) {
    controller.abort((this as AbortSignal).reason);
  }

  if (a.aborted) {
    controller.abort(a.reason);
    return controller.signal;
  }
  if (b.aborted) {
    controller.abort(b.reason);
    return controller.signal;
  }

  a.addEventListener("abort", forward, { once: true });
  b.addEventListener("abort", forward, { once: true });

  return controller.signal;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;

  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

function truncate(text: string, maxLength = 300): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildErrorMessage(response: Response, data: unknown): string {
  const prefix = `HTTP ${response.status} ${response.statusText}`;

  if (typeof data === "string") {
    const text = data.trim();
    return text ? `${prefix}: ${truncate(text)}` : prefix;
  }

  const title = getStringField(data, "title");
  const detail = getStringField(data, "detail");
  const message =
    getStringField(data, "message") ??
    getStringField(data, "error_description") ??
    getStringField(data, "error");

  if (title && detail) return `${prefix}: ${title} — ${detail}`;
  if (detail) return `${prefix}: ${detail}`;
  if (message) return `${prefix}: ${message}`;
  if (title) return `${prefix}: ${title}`;

  return prefix;
}

export class ApiError<T = unknown> extends Error {
  readonly name = "ApiError";
  readonly status: number;
  readonly statusText: string;
  readonly data: T | null;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;

  constructor(
    response: Response,
    data: T | null,
    requestInfo: { method: string; url: string },
  ) {
    super(buildErrorMessage(response, data));
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.data = data;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
  }
}

export class ResponseParseError extends Error {
  readonly name = "ResponseParseError";
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;
  readonly rawBody: string;
  readonly cause: unknown;

  constructor(
    response: Response,
    rawBody: string,
    cause: unknown,
    requestInfo: { method: string; url: string },
  ) {
    super(
      `Failed to parse response from ${requestInfo.method} ${response.url || requestInfo.url} ` +
        `(${response.status} ${response.statusText}) as JSON`,
    );
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
    this.rawBody = rawBody;
    this.cause = cause;
  }
}

async function parseJsonBody(
  response: Response,
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  const raw = await response.text();
  const normalized = stripBom(raw);

  if (normalized.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch (cause) {
    throw new ResponseParseError(response, raw, cause, requestInfo);
  }
}

async function parseErrorBody(response: Response, method: string): Promise<unknown> {
  if (hasNoBody(response, method)) {
    return null;
  }

  const mediaType = getMediaType(response.headers);

  // Fall back to text when blob() is unavailable (e.g. some React Native builds).
  if (mediaType && !isJsonMediaType(mediaType) && !isTextMediaType(mediaType)) {
    return typeof response.blob === "function" ? response.blob() : response.text();
  }

  const raw = await response.text();
  const normalized = stripBom(raw);
  const trimmed = normalized.trim();

  if (trimmed === "") {
    return null;
  }

  if (isJsonMediaType(mediaType) || looksLikeJson(normalized)) {
    try {
      return JSON.parse(normalized);
    } catch {
      return raw;
    }
  }

  return raw;
}

function inferResponseType(response: Response): "json" | "text" | "blob" {
  const mediaType = getMediaType(response.headers);

  if (isJsonMediaType(mediaType)) return "json";
  if (isTextMediaType(mediaType) || mediaType == null) return "text";
  return "blob";
}

async function parseSuccessBody(
  response: Response,
  responseType: "json" | "text" | "blob" | "auto",
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  if (hasNoBody(response, requestInfo.method)) {
    return null;
  }

  const effectiveType =
    responseType === "auto" ? inferResponseType(response) : responseType;

  switch (effectiveType) {
    case "json":
      return parseJsonBody(response, requestInfo);

    case "text": {
      const text = await response.text();
      return text === "" ? null : text;
    }

    case "blob":
      if (typeof response.blob !== "function") {
        throw new TypeError(
          "Blob responses are not supported in this runtime. " +
            "Use responseType \"json\" or \"text\" instead.",
        );
      }
      return response.blob();
  }
}

export async function customFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  input = applyBaseUrl(input);
  const { responseType = "auto", headers: headersInit, timeoutMs = _defaultTimeoutMs, ...init } = options;

  const method = resolveMethod(input, init.method);

  if (init.body != null && (method === "GET" || method === "HEAD")) {
    throw new TypeError(`customFetch: ${method} requests cannot have a body.`);
  }

  const headers = mergeHeaders(isRequest(input) ? input.headers : undefined, headersInit);

  if (
    typeof init.body === "string" &&
    !headers.has("content-type") &&
    looksLikeJson(init.body)
  ) {
    headers.set("content-type", "application/json");
  }

  if (responseType === "json" && !headers.has("accept")) {
    headers.set("accept", DEFAULT_JSON_ACCEPT);
  }

  // Partner acting-as-client header (see setClientContext).
  if (_clientContext && !headers.has("x-client-context")) {
    headers.set("x-client-context", _clientContext);
  }

  // Attach bearer token when an auth getter is configured and no
  // Authorization header has been explicitly provided.
  if (_authTokenGetter && !headers.has("authorization")) {
    const token = await _authTokenGetter();
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
  }

  const requestInfo = { method, url: resolveUrl(input) };

  // Set up a per-request timeout via AbortController.
  const useTimeout = timeoutMs > 0 && isFinite(timeoutMs);
  const timeoutController = useTimeout ? new AbortController() : null;
  const timeoutId = timeoutController
    ? setTimeout(() => timeoutController.abort(), timeoutMs)
    : null;

  const signal =
    timeoutController === null
      ? (init.signal ?? null)
      : init.signal
        ? mergeAbortSignals(init.signal, timeoutController.signal)
        : timeoutController.signal;

  try {
    const response = await fetch(input, { ...init, method, headers, signal: signal ?? undefined });

    if (!response.ok) {
      const errorData = await parseErrorBody(response, method);
      const apiError = new ApiError(response, errorData, requestInfo);
      if (response.status === 401 && _unauthorizedHandler) {
        _unauthorizedHandler(apiError);
      }
      throw apiError;
    }

    return (await parseSuccessBody(response, responseType, requestInfo)) as T;
  } catch (err) {
    // Re-wrap abort errors that originated from our own timeout controller.
    if (
      timeoutController?.signal.aborted &&
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError")
    ) {
      throw new RequestTimeoutError(timeoutMs);
    }
    throw err;
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

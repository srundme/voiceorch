/**
 * Bounded retry wrapper for session-setup DB reads.
 *
 * Production Postgres occasionally throws transient connection-pool errors
 * (ETIMEDOUT / ECONNRESET / "Connection terminated" / "too many clients") under
 * load. During call setup these happen BEFORE the agent speaks, so a single blip
 * would throw straight through createSession → the telephony handler's
 * ws.close() → the call drops on connect with no greeting.
 *
 * withDbRetry retries ONLY transient infra errors with a short exponential
 * backoff. Genuine failures (agent truly missing, unique-violation, syntax
 * error, etc.) are NOT transient and propagate immediately on the first throw.
 */
import { logger } from "../lib/logger.js";

/** Postgres / libpq error codes that indicate a recoverable connection blip. */
const TRANSIENT_DB_ERROR_CODES = new Set<string>([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "08000", // connection_exception
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
  "57P01", // admin_shutdown (server terminated the connection)
  "57P03", // cannot_connect_now
  "53300", // too_many_connections
]);

const TRANSIENT_MESSAGE_RE =
  /timeout|timed out|econnreset|etimedout|connection terminated|connection refused|connection reset|too many clients|terminating connection|server closed the connection|connection closed/i;

/** True when the error looks like a recoverable connection-pool blip. */
export function isTransientDbError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  if (typeof e.code === "string" && TRANSIENT_DB_ERROR_CODES.has(e.code)) return true;
  if (typeof e.message === "string" && TRANSIENT_MESSAGE_RE.test(e.message)) return true;
  return false;
}

export interface DbRetryOpts {
  /** Number of RETRIES after the first attempt (total attempts = retries + 1). */
  retries?: number;
  /** Base backoff in ms; doubles each attempt. */
  baseDelayMs?: number;
}

/**
 * Run `fn`, retrying transient DB connection errors with exponential backoff.
 * `label` is included in the retry log so the failing setup step is identifiable.
 */
export async function withDbRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts: DbRetryOpts = {},
): Promise<T> {
  const retries = opts.retries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 150;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientDbError(err) || attempt === retries) throw err;
      const delayMs = baseDelayMs * 2 ** attempt;
      logger.warn(
        { label, attempt: attempt + 1, retries, delayMs, err },
        "Transient DB error during session setup — retrying",
      );
      await new Promise<void>((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

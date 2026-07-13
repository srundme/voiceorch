/**
 * Converts an unknown thrown value to a human-readable error string with a
 * consistent category prefix (e.g. "STT error", "LLM error", "Telephony error").
 *
 * - Extracts `err.message` when the value is an Error instance.
 * - Strips a leading "Error: " that `String(err)` already injects to prevent
 *   double-prefixing like "STT error: Error: connect ECONNRESET".
 * - Falls back to the raw stringified value when message is unavailable.
 */
export function toReadableError(err: unknown, prefix: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const clean = raw.replace(/^Error:\s*/i, "").trim();
  return clean ? `${prefix}: ${clean}` : prefix;
}

/** Parse a positive integer env var with a safe fallback (ignores NaN / sub-min). */
export function envInt(name: string, def: number, min = 1): number {
  const v = process.env[name];
  if (!v) return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= min ? n : def;
}

/** Best-effort JSON object parse for provider extraConfig blobs. */
export function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }
  return {};
}

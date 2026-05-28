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

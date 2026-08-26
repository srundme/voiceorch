/**
 * Admin call lookup: operators paste whatever the customer gives them —
 * an execution id ("exec_1a2b3c4d"), the bare suffix, or the numeric call id.
 */

export type CallLookup =
  | { kind: "id"; id: number }
  | { kind: "execution"; executionId: string };

const EXECUTION_PREFIX = "exec_";

/** Longest hex-ish suffix we treat as an execution id without the prefix. */
const BARE_EXECUTION_RE = /^[0-9a-f]{6,64}$/i;

export function parseCallLookup(raw: string | undefined | null): CallLookup | null {
  const value = (raw ?? "").trim();
  if (!value) return null;

  if (/^\d+$/.test(value)) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? { kind: "id", id } : null;
  }

  const lower = value.toLowerCase();
  if (lower.startsWith(EXECUTION_PREFIX)) {
    const suffix = lower.slice(EXECUTION_PREFIX.length);
    return suffix ? { kind: "execution", executionId: lower } : null;
  }

  // Bare hex suffix — operators often copy only the part after "exec_".
  if (BARE_EXECUTION_RE.test(value)) {
    return { kind: "execution", executionId: lower };
  }

  return null;
}

/** SQL ILIKE pattern that matches both "exec_abcd" and a bare "abcd" paste. */
export function executionIdSearchPattern(executionId: string): string {
  const bare = executionId.startsWith(EXECUTION_PREFIX)
    ? executionId.slice(EXECUTION_PREFIX.length)
    : executionId;
  return `%${bare}%`;
}

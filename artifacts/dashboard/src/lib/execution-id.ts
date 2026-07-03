/**
 * Single canonical display helper for a call's Execution ID.
 *
 * `execution_id` (format `exec_xxxxxxxx`) is the one real, backend-generated
 * identifier — every call-creation path now stamps it at insert time, and a
 * one-time backfill populated it on historical rows. Nothing here should
 * ever fabricate a value (no `EXE-...`, no `#<id>`): if it's ever missing we
 * show an explicit "Not available" instead of inventing one.
 */
export function getExecutionId(call: { executionId?: string | null } | null | undefined): string {
  const id = call?.executionId;
  return id && id.length > 0 ? id : "Not available";
}

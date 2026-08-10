/**
 * Human-readable disposition chips for call list / detail.
 * Taxonomy results are stored as { [primary]: sub, primary, sub, confidence, summary }.
 * Older or partial rows may only have primary/sub — never hide the outcome.
 */

const DISPOSITION_META_KEYS = new Set([
  "confidence",
  "summary",
  "evidence",
  "primary",
  "sub",
  "flags",
  "needsReview",
  "domainFields",
  "error",
]);

export function getDispositionValues(
  result: Record<string, string | number | boolean | null> | null | undefined,
  /** Keys to treat as “collected data” (not outcome chips). */
  excludeKeys: Iterable<string> = [],
): string[] {
  if (!result || typeof result !== "object") return [];
  const exclude = new Set([...DISPOSITION_META_KEYS, ...excludeKeys]);

  const values = Object.entries(result)
    .filter(([k, v]) => !exclude.has(k) && v != null && v !== "" && typeof v !== "object")
    .map(([, v]) => String(v));

  // Taxonomy fallback: only { primary, sub, … } with no dynamic category key.
  const sub = typeof result["sub"] === "string" ? result["sub"].trim() : "";
  if (sub && !values.includes(sub)) {
    values.unshift(sub);
  }

  return values;
}

export function getDispositionSummary(
  result: Record<string, string | number | boolean | null> | null | undefined,
): string | null {
  if (!result || typeof result !== "object") return null;
  const s = result["summary"];
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

export function getDispositionConfidence(
  result: Record<string, string | number | boolean | null> | null | undefined,
): number | null {
  if (!result || typeof result !== "object") return null;
  const c = result["confidence"];
  return typeof c === "number" && Number.isFinite(c) ? c : null;
}

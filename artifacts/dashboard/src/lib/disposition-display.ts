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

/** Free-text / collected-data keys — not admin outcome labels (Issues list Scenario 2). */
const DATA_COLLECTION_KEY_RE =
  /^(email|e[_-]?mail|phone|mobile|name|first[_-]?name|last[_-]?name|full[_-]?name|address|city|company|business|amount|budget|notes?|comment|feedback|dob|date|age|gst|pan|pincode|zip)$/i;

export function isDispositionDataCollectionKey(key: string): boolean {
  return DATA_COLLECTION_KEY_RE.test(key.trim());
}

/**
 * Flatten agent taxonomy map → unique outcome labels (subs + primaries with no subs).
 * Admin-fixed list for History filters — never invent from call payloads.
 */
export function labelsFromDispositionTaxonomy(
  taxonomy: Record<string, string[]> | null | undefined,
): string[] {
  if (!taxonomy || typeof taxonomy !== "object") return [];
  const out = new Set<string>();
  for (const [primary, subs] of Object.entries(taxonomy)) {
    const p = primary.trim();
    if (!p || isDispositionDataCollectionKey(p)) continue;
    const list = Array.isArray(subs) ? subs : [];
    if (list.length === 0) {
      out.add(p);
      continue;
    }
    for (const sub of list) {
      const s = String(sub ?? "").trim();
      if (s) out.add(s);
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/**
 * Choice options from legacy dispositionSchema — skip text/number free-entry fields.
 */
export function labelsFromDispositionSchema(
  schema: Array<{ key?: string; type?: string; options?: string[] }> | null | undefined,
): string[] {
  if (!Array.isArray(schema)) return [];
  const out = new Set<string>();
  for (const field of schema) {
    if (!field || field.type !== "choice") continue;
    if (field.key && isDispositionDataCollectionKey(field.key)) continue;
    for (const opt of field.options ?? []) {
      const s = String(opt ?? "").trim();
      if (s) out.add(s);
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

export function getDispositionValues(
  result: Record<string, string | number | boolean | null> | null | undefined,
  /** Keys to treat as “collected data” (not outcome chips). */
  excludeKeys: Iterable<string> = [],
): string[] {
  if (!result || typeof result !== "object") return [];
  const exclude = new Set([...DISPOSITION_META_KEYS, ...excludeKeys]);

  const values = Object.entries(result)
    .filter(([k, v]) =>
      !exclude.has(k)
      && !isDispositionDataCollectionKey(k)
      && v != null
      && v !== ""
      && typeof v !== "object")
    .map(([, v]) => String(v));

  // Taxonomy fallback: only { primary, sub, … } with no dynamic category key.
  const sub = typeof result["sub"] === "string" ? result["sub"].trim() : "";
  if (sub && !values.includes(sub)) {
    values.unshift(sub);
  }

  return values;
}

/**
 * Filter a call against an admin disposition label (sub or legacy schema choice).
 */
export function callMatchesDispositionLabel(
  result: Record<string, string | number | boolean | null> | null | undefined,
  label: string,
): boolean {
  const want = label.trim().toLowerCase();
  if (!want) return false;
  return getDispositionValues(result).some((v) => v.trim().toLowerCase() === want);
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

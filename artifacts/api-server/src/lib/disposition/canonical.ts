/**
 * Canonical disposition buckets.
 *
 * Leads store an agent taxonomy label as "primary: sub". In practice that string
 * is messy: the platform prefilter emits categories the agent never configured
 * (NOT_CONNECTED/no_answer), users create a category per outcome ("busy",
 * "not interested") alongside the preset "outcome" container, and casing /
 * underscores vary per LLM provider. Grouping the raw primary therefore produced
 * duplicate KPI cards for the same real-world outcome — "no pickup" (11),
 * "not pickup" (1) and "NOT_CONNECTED" (16) were three cards for one thing.
 *
 * Everything that counts or filters dispositions must go through the helpers
 * here so the SQL bucket and the JS bucket can never drift apart.
 */
import { sql, type SQL } from "drizzle-orm";

/**
 * Category names that are containers rather than outcomes. When the primary is
 * one of these, the sub carries the meaning ("outcome: busy" → "busy").
 */
const GENERIC_PRIMARIES = new Set([
  "outcome",
  "outcomes",
  "disposition",
  "dispositions",
  "result",
  "results",
  "status",
  "call outcome",
  "call status",
  "category",
]);

/**
 * Normalized variant → canonical bucket. Only collapses labels that mean the
 * same thing operationally; distinct outcomes stay distinct.
 */
const SYNONYMS: Record<string, string> = {
  // Never reached a human.
  "no answer": "no pickup",
  "noanswer": "no pickup",
  "no pick up": "no pickup",
  "not pickup": "no pickup",
  "nopickup": "no pickup",
  "not connected": "no pickup",
  "notconnected": "no pickup",
  "unanswered": "no pickup",
  "no response": "no pickup",
  "ring no answer": "no pickup",
  "rna": "no pickup",
  // Busy.
  "line busy": "busy",
  "user busy": "busy",
  // Voicemail.
  "vm": "voicemail",
  "answering machine": "voicemail",
  "machine": "voicemail",
  // Positive intent.
  "very interested": "interested",
  "hot": "interested",
  "hot lead": "interested",
  // Negative intent.
  "uninterested": "not interested",
  "no interest": "not interested",
  "declined": "not interested",
  // Callback.
  "callback": "callback requested",
  "call back": "callback requested",
  "wants callback": "callback requested",
  "call back later": "callback requested",
  "call later": "callback requested",
  // Bad data.
  "invalid number": "wrong number",
  "incorrect number": "wrong number",
  // Suppression.
  "dnc": "do not call",
  "opt out": "do not call",
  "unsubscribe": "do not call",
};

/** lowercase, underscores/hyphens → spaces, collapse whitespace. */
export function normalizeDispositionToken(raw: string | null | undefined): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitDispositionLabel(label: string | null | undefined): {
  primary: string;
  sub: string;
} {
  const raw = String(label ?? "");
  const i = raw.indexOf(":");
  if (i === -1) return { primary: raw.trim(), sub: "" };
  return { primary: raw.slice(0, i).trim(), sub: raw.slice(i + 1).trim() };
}

/**
 * Collapse a primary/sub pair to the single label analytics should count.
 * Returns "" when there is nothing meaningful to bucket.
 */
export function canonicalDispositionBucket(
  primary: string | null | undefined,
  sub: string | null | undefined,
): string {
  const p = normalizeDispositionToken(primary);
  const s = normalizeDispositionToken(sub);
  const base = GENERIC_PRIMARIES.has(p) && s ? s : p;
  if (!base) return "";
  return SYNONYMS[base] ?? base;
}

/** Bucket a stored "primary: sub" lead label. */
export function canonicalDispositionFromLabel(label: string | null | undefined): string {
  const { primary, sub } = splitDispositionLabel(label);
  return canonicalDispositionBucket(primary, sub);
}

/** Title-cased bucket for display ("no pickup" → "No pickup"). */
export function dispositionDisplayLabel(bucket: string): string {
  if (!bucket) return "";
  return bucket.charAt(0).toUpperCase() + bucket.slice(1);
}

/** SQL mirror of normalizeDispositionToken for a text expression. */
function normalizeSql(expr: SQL | string): SQL {
  // Hyphen last inside the bracket expression — Postgres ARE treats a backslash
  // inside brackets as an escape and rejects an undefined one like `\-`.
  return sql`btrim(regexp_replace(regexp_replace(lower(${expr}), '[_-]+', ' ', 'g'), '\\s+', ' ', 'g'))`;
}

/**
 * SQL mirror of canonicalDispositionBucket over a "primary: sub" column.
 * Kept generated from the same maps so SQL grouping and JS bucketing agree.
 */
export function dispositionBucketSql(column: SQL | string): SQL<string> {
  const primary = normalizeSql(sql`split_part(${column}, ':', 1)`);
  const sub = normalizeSql(sql`split_part(${column}, ':', 2)`);

  const genericList = sql.join(
    [...GENERIC_PRIMARIES].map((g) => sql`${g}`),
    sql`, `,
  );
  const base = sql`(case when ${primary} in (${genericList}) and ${sub} <> '' then ${sub} else ${primary} end)`;

  const whens = sql.join(
    Object.entries(SYNONYMS).map(([from, to]) => sql`when ${from} then ${to}`),
    sql` `,
  );
  return sql<string>`(case ${base} ${whens} else ${base} end)`;
}

/**
 * Pure KB lexical helpers (no DB imports) — used by retrieval + unit tests.
 */

export type KbSearchEntry = {
  id: number;
  sourceId: number;
  title: string | null;
  content: string;
  keywords: string | null;
};

export type KbRetrievalSource =
  | "hybrid"
  | "fts"
  | "vector"
  | "lexical"
  | "dump"
  | "prefetch"
  | "none";

/**
 * Pure non-Latin query (e.g. Tamil-only): English FTS cannot tokenize usefully.
 * Code-mixed (Tamil + Latin letters) keeps FTS.
 */
export function isPureNonLatinQuery(q: string): boolean {
  return /\p{L}/u.test(q) && !/[A-Za-z]/.test(q);
}

/** Terms used by the Indic-safe lexical fallback (testable). */
export function buildLexicalSearchTerms(query: string): string[] {
  const q = query.trim();
  if (!q) return [];
  const terms = new Set<string>();
  terms.add(q);
  for (const tok of q.split(/[\s,.;:!?|/\\]+/u)) {
    const t = tok.trim();
    if (t.length >= 2) terms.add(t);
  }
  return Array.from(terms).slice(0, 6);
}

/** Reciprocal-rank fusion of N ranked lists (equal weights), de-duped by id. */
export function rrfMergeLists<T extends { id: number }>(
  lists: T[][],
  topK: number,
  rrfK = 60,
): T[] {
  const scores = new Map<number, { row: T; score: number }>();
  for (const list of lists) {
    list.forEach((row, i) => {
      const prev = scores.get(row.id);
      const s = 1 / (rrfK + i + 1);
      if (prev) prev.score += s;
      else scores.set(row.id, { row, score: s });
    });
  }
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score || a.row.id - b.row.id)
    .slice(0, topK)
    .map((x) => x.row);
}

export function classifyKbRetrievalMode(
  vecHits: number,
  ftsHits: number,
  lexicalHits: number,
): KbRetrievalSource {
  const n = (vecHits ? 1 : 0) + (ftsHits ? 1 : 0) + (lexicalHits ? 1 : 0);
  if (n >= 2) return "hybrid";
  if (vecHits) return "vector";
  if (ftsHits) return "fts";
  if (lexicalHits) return "lexical";
  return "none";
}

/** Dashboard test-search payload — same ranking rows as live retrieval (no LLM rewrite). */
export function buildKnowledgeSearchPayload(result: {
  text: string;
  source: KbRetrievalSource;
  latencyMs: number;
  entries?: KbSearchEntry[];
}): {
  answer: string;
  matchedEntries: Array<{
    entry: KbSearchEntry;
    rank: number;
    snippet: string | null;
  }>;
  mode: KbRetrievalSource;
  latencyMs: number;
  sameAsLiveCalls: true;
} {
  const entries = result.entries ?? [];
  if (!entries.length) {
    return {
      answer: result.source === "none"
        ? "No matching knowledge found for this question (same search as live calls)."
        : "",
      matchedEntries: [],
      mode: result.source,
      latencyMs: result.latencyMs,
      sameAsLiveCalls: true,
    };
  }
  return {
    answer: result.text,
    matchedEntries: entries.map((e, i) => ({
      entry: {
        id: e.id,
        sourceId: e.sourceId,
        title: e.title,
        content: e.content,
        keywords: e.keywords,
      },
      rank: Math.max(0.15, 1 - i * 0.08),
      snippet: null,
    })),
    mode: result.source,
    latencyMs: result.latencyMs,
    sameAsLiveCalls: true,
  };
}

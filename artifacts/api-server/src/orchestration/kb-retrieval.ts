import { db, knowledgeEntriesTable, agentKnowledgeSourcesTable } from "@workspace/db";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { embedKbQuery, isKbVectorReady } from "../services/kb-embeddings.js";

/**
 * Hard ceiling on KB entries sent to the LLM.
 * Beyond ~200 entries the context window gets overwhelmed and recall degrades.
 * Entries are fetched in DB insertion order; the most recently added entries
 * are excluded when the source exceeds this cap.
 */
const MAX_KB_ENTRIES = 200;

/** Max candidates pulled from the vector search before RRF merge. */
const VECTOR_TOP_K = 12;
/** Reciprocal-rank-fusion constant (standard value). */
const RRF_K = 60;

/**
 * Explicit column set for every knowledge_entries read. NEVER select * from
 * this table: (a) the fat `embedding` column must not be shipped to the LLM
 * formatting path, and (b) on databases where migration 0045 soft-failed
 * (no pgvector) the embedding column doesn't exist and select * would error.
 */
const entryCols = {
  id: knowledgeEntriesTable.id,
  title: knowledgeEntriesTable.title,
  content: knowledgeEntriesTable.content,
  keywords: knowledgeEntriesTable.keywords,
};

type EntryRow = { id: number; title: string | null; content: string; keywords: string | null };

/** Format a single knowledge entry row into a prompt-injectable block. */
function formatEntry(e: { title?: string | null; content: string; keywords?: string | null }): string {
  const parts: string[] = [];
  if (e.title) parts.push(`Title: ${e.title}`);
  parts.push(`Content: ${e.content}`);
  if (e.keywords) parts.push(`Keywords: ${e.keywords}`);
  return parts.join("\n");
}

function formatEntries(entries: EntryRow[]): string {
  return entries.map((e) => formatEntry(e)).join("\n\n---\n\n");
}

/* ── Search primitives (cross-source) ────────────────────────────────────── */

/** FTS search across sources. Throws on DB error (caller handles). */
async function ftsSearch(sourceIds: number[], query: string, limit: number): Promise<EntryRow[]> {
  type FtsRow = EntryRow & { rank: number };
  const rows = await db.execute<FtsRow>(sql`
    SELECT id, title, content, keywords,
      ts_rank_cd(
        to_tsvector('english',
          coalesce(title, '') || ' ' || content || ' ' || coalesce(keywords, '')
        ),
        plainto_tsquery('english', ${query})
      ) AS rank
    FROM knowledge_entries
    WHERE source_id IN (${sql.join(sourceIds.map((id) => sql`${id}`), sql`, `)})
      AND to_tsvector('english',
            coalesce(title, '') || ' ' || content || ' ' || coalesce(keywords, '')
          ) @@ plainto_tsquery('english', ${query})
    ORDER BY rank DESC, id ASC
    LIMIT ${limit}
  `);
  return rows.rows as FtsRow[];
}

/**
 * Semantic vector search across sources (pgvector cosine). Returns [] when
 * the vector latch is off or the query embedding is unavailable (no key,
 * timeout, API error) — never throws for those; DB errors propagate.
 */
async function vectorSearch(sourceIds: number[], query: string, limit: number): Promise<EntryRow[]> {
  if (!isKbVectorReady()) return [];
  const qvec = await embedKbQuery(query);
  if (!qvec) return [];
  const vecLiteral = `[${qvec.join(",")}]`;
  const rows = await db.execute<EntryRow & { dist: number }>(sql`
    SELECT id, title, content, keywords,
      (embedding <=> ${vecLiteral}::vector) AS dist
    FROM knowledge_entries
    WHERE source_id IN (${sql.join(sourceIds.map((id) => sql`${id}`), sql`, `)})
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vecLiteral}::vector
    LIMIT ${limit}
  `);
  return rows.rows as EntryRow[];
}

/** Reciprocal-rank fusion of two ranked lists (equal weights), de-duped by id. */
function rrfMerge(listA: EntryRow[], listB: EntryRow[], topK: number): EntryRow[] {
  const scores = new Map<number, { row: EntryRow; score: number }>();
  const add = (list: EntryRow[]) => {
    list.forEach((row, i) => {
      const prev = scores.get(row.id);
      const s = 1 / (RRF_K + i + 1);
      if (prev) prev.score += s;
      else scores.set(row.id, { row, score: s });
    });
  };
  add(listA);
  add(listB);
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score || a.row.id - b.row.id)
    .slice(0, topK)
    .map((x) => x.row);
}

/* ── Public API ──────────────────────────────────────────────────────────── */

/**
 * How a per-turn KB retrieval result was produced (for execution-log
 * diagnostics). "prefetch" is assigned by the pipeline when the speech-start
 * full dump wins the turn over the live query retrieval.
 */
export type KbRetrievalSource = "hybrid" | "fts" | "vector" | "dump" | "prefetch" | "none";

export interface KbRetrievalResult {
  /** Prompt-injectable context block ("" = no hit). */
  text: string;
  source: KbRetrievalSource;
  latencyMs: number;
  /** True when served from the in-memory query cache (source reflects the original lookup). */
  cached?: boolean;
}

export interface KbRetrievalOpts {
  /**
   * Skip PostgreSQL FTS and use vector search only. Set for pure non-Latin
   * queries (e.g. Tamil-only): the 'english' FTS config cannot stem/tokenize
   * them usefully, so FTS is wasted latency and rank noise there. Code-mixed
   * queries (Tamil script + English words) must keep FTS.
   */
  skipFts?: boolean;
  /**
   * Character cap applied ONLY to the empty-query full-dump path (prefetch
   * fallback). Undefined = no cap (call-start baked injection keeps its own
   * separate capping in session.ts).
   */
  dumpMaxChars?: number;
}

/* ── In-memory LRU cache for repeated queries ────────────────────────────────
 * Keyed by sorted sourceIds + normalized query text (lowercased, trimmed) —
 * NOT query alone, so agents with different KB attachments can never see each
 * other's cached context. 10-minute TTL; LRU eviction at the size cap.
 * `skipFts` is deterministic from the query text, so it need not be in the key.
 */
const KB_QUERY_CACHE_TTL_MS = 10 * 60 * 1000;
const KB_QUERY_CACHE_MAX = 500;
const kbQueryCache = new Map<string, { text: string; source: KbRetrievalSource; expiresAt: number }>();

function kbCacheGet(key: string): { text: string; source: KbRetrievalSource } | null {
  const hit = kbQueryCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    kbQueryCache.delete(key);
    return null;
  }
  // LRU touch: re-insert so Map iteration order reflects recency.
  kbQueryCache.delete(key);
  kbQueryCache.set(key, hit);
  return { text: hit.text, source: hit.source };
}

function kbCacheSet(key: string, text: string, source: KbRetrievalSource): void {
  if (kbQueryCache.size >= KB_QUERY_CACHE_MAX) {
    // Evict least-recently-used (first key in insertion/recency order).
    const oldest = kbQueryCache.keys().next().value;
    if (oldest !== undefined) kbQueryCache.delete(oldest);
  }
  kbQueryCache.set(key, { text, source, expiresAt: Date.now() + KB_QUERY_CACHE_TTL_MS });
}

/**
 * Per-turn retrieval across MULTIPLE sources (pipeline use) with result
 * metadata for execution-log diagnostics.
 *
 * Strategy:
 * - Non-empty `query`: HYBRID retrieval — semantic vector search (pgvector
 *   cosine over gemini-embedding-001 vectors, multilingual) fused with
 *   PostgreSQL FTS via reciprocal-rank fusion. Vector search degrades to []
 *   on any failure (latch off, no key, embed timeout), leaving pure FTS —
 *   i.e. exactly the pre-vector behavior. A total DB failure returns "".
 *   Repeated queries within 10 minutes are served from an in-memory cache.
 * - Empty `query` (prefetch/full-dump): entries with pinned first, then
 *   insertion order, up to MAX_KB_ENTRIES (optionally char-capped via
 *   `dumpMaxChars` — used by the per-turn prefetch fallback only).
 */
export async function retrieveKbContextMultiEx(
  sourceIds: number[],
  query: string,
  topK = 50,
  opts: KbRetrievalOpts = {},
): Promise<KbRetrievalResult> {
  const t0 = Date.now();
  const unique = Array.from(new Set(sourceIds.filter((n) => Number.isInteger(n))));
  if (!unique.length) return { text: "", source: "none", latencyMs: Date.now() - t0 };
  const q = query.trim();
  const cap = Math.min(Math.max(topK, 10), MAX_KB_ENTRIES);

  if (!q) {
    const text = await dumpEntries(unique, MAX_KB_ENTRIES, opts.dumpMaxChars);
    return { text, source: text ? "dump" : "none", latencyMs: Date.now() - t0 };
  }

  const cacheKey = `${[...unique].sort((a, b) => a - b).join(",")}::${q.toLowerCase()}`;
  const cachedHit = kbCacheGet(cacheKey);
  if (cachedHit) {
    return { text: cachedHit.text, source: cachedHit.source, latencyMs: Date.now() - t0, cached: true };
  }

  try {
    // Vector + FTS run concurrently; vector failure yields [] (pure FTS).
    // skipFts (pure non-Latin query) goes straight to vector-only.
    const [vecRows, ftsRows] = await Promise.all([
      vectorSearch(unique, q, VECTOR_TOP_K).catch((err) => {
        logger.warn({ err: String(err), sourceIds: unique }, "KB vector search failed — FTS-only this turn");
        return [] as EntryRow[];
      }),
      opts.skipFts ? Promise.resolve([] as EntryRow[]) : ftsSearch(unique, q, cap),
    ]);
    const merged = rrfMerge(vecRows, ftsRows, cap);
    const source: KbRetrievalSource =
      vecRows.length && ftsRows.length ? "hybrid"
      : vecRows.length ? "vector"
      : ftsRows.length ? "fts"
      : "none";
    logger.info(
      { sourceIds: unique, mode: source, skipFts: opts.skipFts === true, vecHits: vecRows.length, ftsHits: ftsRows.length, merged: merged.length, ms: Date.now() - t0 },
      "KB retrieval",
    );
    const text = merged.length ? formatEntries(merged) : "";
    kbCacheSet(cacheKey, text, source);
    return { text, source, latencyMs: Date.now() - t0 };
  } catch (err) {
    logger.warn({ err, sourceIds: unique }, "KB context load failed");
    return { text: "", source: "none", latencyMs: Date.now() - t0 };
  }
}

/**
 * Back-compat string variant (delegates to retrieveKbContextMultiEx).
 */
export async function retrieveKbContextMulti(
  sourceIds: number[],
  query: string,
  topK = 50,
): Promise<string> {
  const res = await retrieveKbContextMultiEx(sourceIds, query, topK);
  return res.text;
}

/**
 * Single-source variant kept for backward compatibility (delegates to the
 * multi-source implementation).
 */
export async function retrieveKbContext(
  knowledgeSourceId: number,
  query: string,
  topK = 50,
): Promise<string> {
  return retrieveKbContextMulti([knowledgeSourceId], query, topK);
}

/**
 * Full-dump helper: pinned entries first, then insertion order, capped at
 * `cap` entries. Optional `maxChars` truncates the FORMATTED block on an
 * entry/newline boundary — used ONLY by the per-turn prefetch fallback
 * (pipeline.ts passes 8000); the call-start baked path passes no cap and
 * keeps its own separate 4,000-char handling in session.ts.
 */
async function dumpEntries(sourceIds: number[], cap: number, maxChars?: number): Promise<string> {
  let entries: EntryRow[];
  try {
    entries = await db
      .select(entryCols)
      .from(knowledgeEntriesTable)
      .where(inArray(knowledgeEntriesTable.sourceId, sourceIds))
      .orderBy(desc(knowledgeEntriesTable.pinned), knowledgeEntriesTable.id)
      .limit(cap);
  } catch (err) {
    // Deploy-order resilience: if migration 0048 has not been applied yet the
    // `pinned` column doesn't exist and the ordered query errors. Retry with
    // the legacy insertion-order query so KB injection never goes dark during
    // the deploy→migrate window.
    logger.warn({ err, sourceIds }, "KB dump with pinned ordering failed — retrying without pinned (migration 0048 applied?)");
    try {
      entries = await db
        .select(entryCols)
        .from(knowledgeEntriesTable)
        .where(inArray(knowledgeEntriesTable.sourceId, sourceIds))
        .orderBy(knowledgeEntriesTable.id)
        .limit(cap);
    } catch (err2) {
      logger.warn({ err: err2, sourceIds }, "KB context load failed");
      return "";
    }
  }
  if (!entries.length) return "";
  if (entries.length >= MAX_KB_ENTRIES) {
    logger.warn({ sourceIds, cap: MAX_KB_ENTRIES }, "KB entries capped at MAX_KB_ENTRIES");
  }
  let text = formatEntries(entries);
  if (maxChars !== undefined && Number.isFinite(maxChars) && maxChars > 0 && text.length > maxChars) {
    // Prefer cutting at an entry separator, else a newline, else hard cut —
    // never mid-word if avoidable. Pinned entries sort first, so the curated
    // summary always survives the cut.
    const sepIdx = text.lastIndexOf("\n\n---\n\n", maxChars);
    const nlIdx = text.lastIndexOf("\n", maxChars);
    const cut = sepIdx > maxChars * 0.5 ? sepIdx : nlIdx > maxChars * 0.5 ? nlIdx : maxChars;
    logger.info({ sourceIds, maxChars, originalChars: text.length, keptChars: cut }, "KB dump truncated to maxChars");
    text = text.slice(0, cut);
  }
  return text;
}

/**
 * Resolve the full set of knowledge source IDs attached to an agent: the M:N
 * join table (`agent_knowledge_sources`) unioned with the legacy single
 * `knowledgeBaseId` column. De-duplicated; order is not significant.
 */
export async function getAttachedSourceIds(
  agentId: number,
  legacyKnowledgeBaseId?: number | null,
): Promise<number[]> {
  const ids = new Set<number>();
  if (legacyKnowledgeBaseId != null) ids.add(legacyKnowledgeBaseId);
  try {
    const links = await db
      .select({ sourceId: agentKnowledgeSourcesTable.sourceId })
      .from(agentKnowledgeSourcesTable)
      .where(eq(agentKnowledgeSourcesTable.agentId, agentId));
    for (const l of links) ids.add(l.sourceId);
  } catch (err) {
    logger.warn({ err, agentId }, "Failed to load attached knowledge sources — falling back to legacy id only");
  }
  return Array.from(ids);
}

/**
 * Load all knowledge entries across MULTIPLE sources and format them as a
 * single prompt-injectable context block. Used by the full-dump injection
 * paths (session start, webcall start). Respects the global MAX_KB_ENTRIES cap
 * across the combined set. Returns "" when there are no entries.
 */
export async function buildKnowledgeBaseBlock(sourceIds: number[]): Promise<string> {
  const unique = Array.from(new Set(sourceIds.filter((n) => Number.isInteger(n))));
  if (!unique.length) return "";
  return dumpEntries(unique, MAX_KB_ENTRIES);
}

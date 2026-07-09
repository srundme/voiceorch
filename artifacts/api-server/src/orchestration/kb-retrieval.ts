import { db, knowledgeEntriesTable, agentKnowledgeSourcesTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
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
 * Per-turn retrieval across MULTIPLE sources (pipeline use).
 *
 * Strategy:
 * - Non-empty `query`: HYBRID retrieval — semantic vector search (pgvector
 *   cosine over gemini-embedding-001 vectors, multilingual) fused with
 *   PostgreSQL FTS via reciprocal-rank fusion. Vector search degrades to []
 *   on any failure (latch off, no key, embed timeout), leaving pure FTS —
 *   i.e. exactly the pre-vector behavior. A total DB failure returns "".
 * - Empty `query` (prefetch/full-dump): entries in insertion order up to
 *   MAX_KB_ENTRIES, unchanged from the pre-vector behavior.
 */
export async function retrieveKbContextMulti(
  sourceIds: number[],
  query: string,
  topK = 50,
): Promise<string> {
  const unique = Array.from(new Set(sourceIds.filter((n) => Number.isInteger(n))));
  if (!unique.length) return "";
  const q = query.trim();
  const cap = Math.min(Math.max(topK, 10), MAX_KB_ENTRIES);

  if (!q) return dumpEntries(unique, MAX_KB_ENTRIES);

  const t0 = Date.now();
  try {
    // Vector + FTS run concurrently; vector failure yields [] (pure FTS).
    const [vecRows, ftsRows] = await Promise.all([
      vectorSearch(unique, q, VECTOR_TOP_K).catch((err) => {
        logger.warn({ err: String(err), sourceIds: unique }, "KB vector search failed — FTS-only this turn");
        return [] as EntryRow[];
      }),
      ftsSearch(unique, q, cap),
    ]);
    const merged = rrfMerge(vecRows, ftsRows, cap);
    logger.info(
      { sourceIds: unique, mode: vecRows.length ? "hybrid" : "fts", vecHits: vecRows.length, ftsHits: ftsRows.length, merged: merged.length, ms: Date.now() - t0 },
      "KB retrieval",
    );
    if (!merged.length) return "";
    return formatEntries(merged);
  } catch (err) {
    logger.warn({ err, sourceIds: unique }, "KB context load failed");
    return "";
  }
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

/** Full-dump helper (insertion order, capped). */
async function dumpEntries(sourceIds: number[], cap: number): Promise<string> {
  try {
    const entries = await db
      .select(entryCols)
      .from(knowledgeEntriesTable)
      .where(inArray(knowledgeEntriesTable.sourceId, sourceIds))
      .orderBy(knowledgeEntriesTable.id)
      .limit(cap);
    if (!entries.length) return "";
    if (entries.length >= MAX_KB_ENTRIES) {
      logger.warn({ sourceIds, cap: MAX_KB_ENTRIES }, "KB entries capped at MAX_KB_ENTRIES");
    }
    return formatEntries(entries);
  } catch (err) {
    logger.warn({ err, sourceIds }, "KB context load failed");
    return "";
  }
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

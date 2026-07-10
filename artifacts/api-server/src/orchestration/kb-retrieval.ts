import { db, knowledgeEntriesTable, agentKnowledgeSourcesTable } from "@workspace/db";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { embedKbQuery, isKbVectorReady } from "../services/kb-embeddings.js";

/**
 * Hard ceiling on KB entries sent to the LLM.
 * Beyond ~200 entries the context window gets overwhelmed and recall degrades.
 * With multiple attached sources this budget is split FAIRLY across sources
 * (with rollover) instead of first-source-wins insertion order.
 */
const MAX_KB_ENTRIES = 200;

/** Max candidates pulled from the vector search before RRF merge. */
const VECTOR_TOP_K = 12;
/** Reciprocal-rank-fusion constant (standard value). */
const RRF_K = 60;

/** Separator between formatted entries (and between per-source blocks). */
const ENTRY_SEP = "\n\n---\n\n";

/**
 * Explicit column set for every knowledge_entries read. NEVER select * from
 * this table: (a) the fat `embedding` column must not be shipped to the LLM
 * formatting path, and (b) on databases where migration 0045 soft-failed
 * (no pgvector) the embedding column doesn't exist and select * would error.
 */
const entryCols = {
  id: knowledgeEntriesTable.id,
  sourceId: knowledgeEntriesTable.sourceId,
  title: knowledgeEntriesTable.title,
  content: knowledgeEntriesTable.content,
  keywords: knowledgeEntriesTable.keywords,
};

type EntryRow = {
  id: number;
  sourceId: number;
  title: string | null;
  content: string;
  keywords: string | null;
};

/** Format a single knowledge entry row into a prompt-injectable block. */
function formatEntry(e: { title?: string | null; content: string; keywords?: string | null }): string {
  const parts: string[] = [];
  if (e.title) parts.push(`Title: ${e.title}`);
  parts.push(`Content: ${e.content}`);
  if (e.keywords) parts.push(`Keywords: ${e.keywords}`);
  return parts.join("\n");
}

function formatEntries(entries: EntryRow[]): string {
  return entries.map((e) => formatEntry(e)).join(ENTRY_SEP);
}

/** Distinct source IDs (ascending) present in a result row set. */
function rowSourceIds(rows: Array<{ sourceId: number }>): number[] {
  return Array.from(new Set(rows.map((r) => r.sourceId))).sort((a, b) => a - b);
}

/* ── Fair multi-source dump allocation ───────────────────────────────────── */

export interface KbFairDumpEntry {
  id: number;
  sourceId: number;
  title: string | null;
  content: string;
  keywords: string | null;
  pinned: boolean;
}

export interface KbFairDumpPerSource {
  sourceId: number;
  /** Entries available for this source (after fetch). */
  totalEntries: number;
  /** Entries that made it into the final block. */
  keptEntries: number;
  /** Characters this source contributed to the final block. */
  chars: number;
  /** True when this source lost entries or characters to a budget cap. */
  truncated: boolean;
}

export interface KbFairDumpResult {
  text: string;
  contributingSourceIds: number[];
  /** True when ANY source was cut by the entry or char budget. */
  truncated: boolean;
  perSource: KbFairDumpPerSource[];
}

/**
 * Waterfill allocator: split `budget` across `needs` fairly with rollover.
 * Every index whose need fits inside the current equal share is satisfied in
 * full and its unused share is redistributed to the rest; indices still over
 * budget at the end split the remainder evenly. Guarantees no index is
 * starved while another wastes budget.
 */
function waterfill(needs: number[], budget: number): number[] {
  const n = needs.length;
  const alloc = new Array<number>(n).fill(0);
  if (n === 0 || budget <= 0) return alloc;
  const remaining = new Set<number>(needs.map((_, i) => i));
  let left = budget;
  let progressed = true;
  while (progressed && remaining.size > 0 && left > 0) {
    progressed = false;
    const share = Math.floor(left / remaining.size);
    for (const i of Array.from(remaining)) {
      if (needs[i]! <= share) {
        alloc[i] = needs[i]!;
        left -= needs[i]!;
        remaining.delete(i);
        progressed = true;
      }
    }
  }
  if (remaining.size > 0) {
    const share = Math.floor(left / remaining.size);
    for (const i of remaining) alloc[i] = share;
  }
  return alloc;
}

/**
 * Truncate a formatted block to `maxChars`, preferring an entry separator,
 * else a newline, else a hard cut (same boundary heuristics the legacy
 * single-source dump used — single-source output stays byte-identical).
 */
function truncateBlock(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const sepIdx = text.lastIndexOf(ENTRY_SEP, maxChars);
  const nlIdx = text.lastIndexOf("\n", maxChars);
  const cut = sepIdx > maxChars * 0.5 ? sepIdx : nlIdx > maxChars * 0.5 ? nlIdx : maxChars;
  return text.slice(0, cut);
}

/**
 * Assemble a full-dump KB block from entries spanning one or more sources,
 * splitting BOTH the entry budget and the char budget fairly across sources
 * (waterfill with rollover: a thin source's unused budget flows to the
 * others). Pinned entries lead WITHIN each source, so one source's pinned
 * entries can never crowd out another source's pinned entries — pinned
 * priority is source-scoped, not global-insertion-order.
 *
 * Single-source behavior is identical to the legacy dump: pinned first, then
 * insertion order, capped at maxEntries, truncated on an entry/newline
 * boundary at maxChars.
 */
export function buildFairDump(
  entries: KbFairDumpEntry[],
  opts: { maxEntries: number; maxChars?: number },
): KbFairDumpResult {
  const empty: KbFairDumpResult = { text: "", contributingSourceIds: [], truncated: false, perSource: [] };
  if (!entries.length) return empty;

  // Group by source, ascending sourceId; within a source: pinned first, then id.
  const groups = new Map<number, KbFairDumpEntry[]>();
  for (const e of entries) {
    const g = groups.get(e.sourceId);
    if (g) g.push(e);
    else groups.set(e.sourceId, [e]);
  }
  const sourceIds = Array.from(groups.keys()).sort((a, b) => a - b);
  for (const id of sourceIds) {
    groups.get(id)!.sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || a.id - b.id);
  }

  // 1. Entry-count budget, fair with rollover.
  const counts = sourceIds.map((id) => groups.get(id)!.length);
  const entryAlloc = waterfill(counts, Math.max(1, opts.maxEntries));

  // 2. Per-source formatted blocks after the entry cap.
  const blocks = sourceIds.map((id, i) => {
    const kept = groups.get(id)!.slice(0, entryAlloc[i]!);
    return { sourceId: id, kept, text: formatEntries(kept) };
  });

  // 3. Char budget, fair with rollover. Reserve the inter-source separators
  //    up front so the assembled block respects the cap.
  const maxChars = opts.maxChars;
  const perSource: KbFairDumpPerSource[] = [];
  const finalBlocks: string[] = [];
  if (maxChars !== undefined && Number.isFinite(maxChars) && maxChars > 0) {
    const sepReserve = Math.max(0, blocks.filter((b) => b.text.length > 0).length - 1) * ENTRY_SEP.length;
    const charBudget = Math.max(0, maxChars - sepReserve);
    const charAlloc = waterfill(blocks.map((b) => b.text.length), charBudget);
    blocks.forEach((b, i) => {
      const cut = truncateBlock(b.text, charAlloc[i]!);
      const total = groups.get(b.sourceId)!.length;
      // Count entries that fully survived the char cut.
      const keptEntries = cut.length === b.text.length
        ? b.kept.length
        : cut.length === 0 ? 0 : cut.split(ENTRY_SEP).length;
      perSource.push({
        sourceId: b.sourceId,
        totalEntries: total,
        keptEntries,
        chars: cut.length,
        truncated: cut.length < b.text.length || b.kept.length < total,
      });
      if (cut.length > 0) finalBlocks.push(cut);
    });
  } else {
    blocks.forEach((b) => {
      const total = groups.get(b.sourceId)!.length;
      perSource.push({
        sourceId: b.sourceId,
        totalEntries: total,
        keptEntries: b.kept.length,
        chars: b.text.length,
        truncated: b.kept.length < total,
      });
      if (b.text.length > 0) finalBlocks.push(b.text);
    });
  }

  const text = finalBlocks.join(ENTRY_SEP);
  return {
    text,
    contributingSourceIds: perSource.filter((s) => s.chars > 0).map((s) => s.sourceId),
    truncated: perSource.some((s) => s.truncated),
    perSource,
  };
}

/* ── Per-turn retrieval budget (skipFts-aware) ───────────────────────────── */

/**
 * Inner live-retrieval budget for a turn, before the pipeline settles for the
 * speech-start prefetch dump instead.
 *
 * Default 200ms for hybrid (FTS+vector) turns: FTS alone typically answers in
 * tens of ms, so the budget mostly bounds the vector side.
 *
 * skipFts (pure non-Latin, e.g. Tamil-only) turns are VECTOR-ONLY: the turn
 * cannot produce anything until the query embed returns. Measured
 * gemini-embedding-001 latency for Tamil queries (2026-07-10, n=20):
 * p50=510ms, p90=548ms, p99=1112ms — a 200ms budget meant the live semantic
 * path lost to the dump fallback on essentially every Tamil turn (call 2159:
 * 8/8 turns served the truncated dump). Default 800ms = p90 + vector-search
 * round-trip + margin; the dump fallback still guards the turn if the embed
 * runs long.
 */
export function resolveKbTurnBudgetMs(skipFts: boolean): number {
  if (skipFts) {
    const v = Number(process.env["KB_TURN_RETRIEVAL_BUDGET_SKIPFTS_MS"] ?? 800);
    return Number.isFinite(v) && v > 0 ? v : 800;
  }
  const v = Number(process.env["KB_TURN_RETRIEVAL_BUDGET_MS"] ?? 200);
  return Number.isFinite(v) && v > 0 ? v : 200;
}

/* ── Search primitives (cross-source) ────────────────────────────────────── */

/** FTS search across sources. Throws on DB error (caller handles). */
async function ftsSearch(sourceIds: number[], query: string, limit: number): Promise<EntryRow[]> {
  type FtsRow = EntryRow & { rank: number };
  const rows = await db.execute<FtsRow>(sql`
    SELECT id, source_id AS "sourceId", title, content, keywords,
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
    SELECT id, source_id AS "sourceId", title, content, keywords,
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
  /** Source IDs whose entries actually landed in `text` (starvation diagnosis). */
  contributingSourceIds?: number[];
  /** Dump paths only: true when the char/entry budget cut any source's content. */
  truncated?: boolean;
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
   * fallback). Undefined = no cap (call-start baked injection passes its own
   * cap via buildKnowledgeBaseBlockEx).
   */
  dumpMaxChars?: number;
  /**
   * Entry titles to exclude from BOTH the dump and live-retrieval paths.
   * Used to keep provider-scoped synthetic entries (e.g. the Krutrim
   * auto-summary — see kb-source-summary.ts) out of every OTHER provider's
   * context when a knowledge source is shared across agents with different
   * LLM providers.
   */
  excludeTitles?: string[];
}

/* ── In-memory LRU cache for repeated queries ────────────────────────────────
 * Keyed by sorted sourceIds + normalized query text (lowercased, trimmed) —
 * NOT query alone, so agents with different KB attachments can never see each
 * other's cached context. 10-minute TTL; LRU eviction at the size cap.
 * `skipFts` is deterministic from the query text, so it need not be in the key.
 */
const KB_QUERY_CACHE_TTL_MS = 10 * 60 * 1000;
const KB_QUERY_CACHE_MAX = 500;
type KbCacheVal = { text: string; source: KbRetrievalSource; contributingSourceIds: number[]; expiresAt: number };
const kbQueryCache = new Map<string, KbCacheVal>();

function kbCacheGet(key: string): Omit<KbCacheVal, "expiresAt"> | null {
  const hit = kbQueryCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    kbQueryCache.delete(key);
    return null;
  }
  // LRU touch: re-insert so Map iteration order reflects recency.
  kbQueryCache.delete(key);
  kbQueryCache.set(key, hit);
  return { text: hit.text, source: hit.source, contributingSourceIds: hit.contributingSourceIds };
}

function kbCacheSet(key: string, text: string, source: KbRetrievalSource, contributingSourceIds: number[]): void {
  if (kbQueryCache.size >= KB_QUERY_CACHE_MAX) {
    // Evict least-recently-used (first key in insertion/recency order).
    const oldest = kbQueryCache.keys().next().value;
    if (oldest !== undefined) kbQueryCache.delete(oldest);
  }
  kbQueryCache.set(key, { text, source, contributingSourceIds, expiresAt: Date.now() + KB_QUERY_CACHE_TTL_MS });
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
 * - Empty `query` (prefetch/full-dump): fair multi-source dump — the entry
 *   and char budgets are split across the attached sources with rollover so
 *   no source is starved (optionally char-capped via `dumpMaxChars` — used
 *   by the per-turn prefetch fallback only).
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
    const dump = await dumpEntries(unique, MAX_KB_ENTRIES, opts.dumpMaxChars, opts.excludeTitles);
    return {
      text: dump.text,
      source: dump.text ? "dump" : "none",
      latencyMs: Date.now() - t0,
      contributingSourceIds: dump.contributingSourceIds,
      truncated: dump.truncated,
    };
  }

  // excludeTitles changes what a query can return, so it MUST be part of the
  // cache key — otherwise a Krutrim agent's cache entry (auto-summary
  // included) could be served to a non-Krutrim agent sharing the same
  // source, or vice versa.
  const excludeKey = opts.excludeTitles?.length ? `!${[...opts.excludeTitles].sort().join("|")}` : "";
  const cacheKey = `${[...unique].sort((a, b) => a - b).join(",")}::${q.toLowerCase()}${excludeKey}`;
  const cachedHit = kbCacheGet(cacheKey);
  if (cachedHit) {
    return {
      text: cachedHit.text,
      source: cachedHit.source,
      latencyMs: Date.now() - t0,
      cached: true,
      contributingSourceIds: cachedHit.contributingSourceIds,
    };
  }

  try {
    // Vector + FTS run concurrently; vector failure yields [] (pure FTS).
    // skipFts (pure non-Latin query) goes straight to vector-only.
    const [vecRowsRaw, ftsRowsRaw] = await Promise.all([
      vectorSearch(unique, q, VECTOR_TOP_K).catch((err) => {
        logger.warn({ err: String(err), sourceIds: unique }, "KB vector search failed — FTS-only this turn");
        return [] as EntryRow[];
      }),
      opts.skipFts ? Promise.resolve([] as EntryRow[]) : ftsSearch(unique, q, cap),
    ]);
    const excluded = opts.excludeTitles?.length ? new Set(opts.excludeTitles) : null;
    const dropExcluded = (rows: EntryRow[]) => excluded ? rows.filter((r) => !r.title || !excluded.has(r.title)) : rows;
    const vecRows = dropExcluded(vecRowsRaw);
    const ftsRows = dropExcluded(ftsRowsRaw);
    const merged = rrfMerge(vecRows, ftsRows, cap);
    const source: KbRetrievalSource =
      vecRows.length && ftsRows.length ? "hybrid"
      : vecRows.length ? "vector"
      : ftsRows.length ? "fts"
      : "none";
    const contributingSourceIds = rowSourceIds(merged);
    logger.info(
      { sourceIds: unique, mode: source, skipFts: opts.skipFts === true, vecHits: vecRows.length, ftsHits: ftsRows.length, merged: merged.length, contributingSourceIds, ms: Date.now() - t0 },
      "KB retrieval",
    );
    const text = merged.length ? formatEntries(merged) : "";
    kbCacheSet(cacheKey, text, source, contributingSourceIds);
    return { text, source, latencyMs: Date.now() - t0, contributingSourceIds };
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
 * Full-dump helper with FAIR multi-source budgeting (see buildFairDump).
 * Fetches up to `cap` entries PER SOURCE (pinned first, then insertion
 * order) and lets the allocator split the combined entry + char budgets.
 */
async function dumpEntries(sourceIds: number[], cap: number, maxChars?: number, excludeTitles?: string[]): Promise<KbFairDumpResult> {
  // Fetch up to `cap` rows PER SOURCE at the SQL level via a window function.
  // A global LIMIT here would let one source (e.g. many pinned/low-id rows)
  // consume the entire fetch window and starve other sources before the
  // fair allocator ever runs — this was the original call-2159 starvation
  // class and must not resurface at the fetch stage.
  let entries: KbFairDumpEntry[];
  try {
    const rn = sql<number>`row_number() over (partition by ${knowledgeEntriesTable.sourceId} order by ${knowledgeEntriesTable.pinned} desc, ${knowledgeEntriesTable.id} asc)`;
    const ranked = db.$with("kb_dump_ranked").as(
      db
        .select({ ...entryCols, pinned: knowledgeEntriesTable.pinned, rn: rn.as("rn") })
        .from(knowledgeEntriesTable)
        .where(inArray(knowledgeEntriesTable.sourceId, sourceIds)),
    );
    const rows = await db
      .with(ranked)
      .select({ id: ranked.id, sourceId: ranked.sourceId, title: ranked.title, content: ranked.content, keywords: ranked.keywords, pinned: ranked.pinned })
      .from(ranked)
      .where(sql`${ranked.rn} <= ${cap}`);
    entries = rows;
  } catch (err) {
    // Deploy-order resilience: if migration 0048 has not been applied yet the
    // `pinned` column doesn't exist and the ordered query errors. Retry with
    // the legacy insertion-order query (still per-source capped) so KB
    // injection never goes dark during the deploy→migrate window.
    logger.warn({ err, sourceIds }, "KB dump with pinned ordering failed — retrying without pinned (migration 0048 applied?)");
    try {
      const rn = sql<number>`row_number() over (partition by ${knowledgeEntriesTable.sourceId} order by ${knowledgeEntriesTable.id} asc)`;
      const ranked = db.$with("kb_dump_ranked_legacy").as(
        db
          .select({ ...entryCols, rn: rn.as("rn") })
          .from(knowledgeEntriesTable)
          .where(inArray(knowledgeEntriesTable.sourceId, sourceIds)),
      );
      const rows = await db
        .with(ranked)
        .select({ id: ranked.id, sourceId: ranked.sourceId, title: ranked.title, content: ranked.content, keywords: ranked.keywords })
        .from(ranked)
        .where(sql`${ranked.rn} <= ${cap}`);
      entries = rows.map((r) => ({ ...r, pinned: false }));
    } catch (err2) {
      logger.warn({ err: err2, sourceIds }, "KB context load failed");
      return { text: "", contributingSourceIds: [], truncated: false, perSource: [] };
    }
  }
  if (excludeTitles?.length) {
    const excluded = new Set(excludeTitles);
    entries = entries.filter((e) => !e.title || !excluded.has(e.title));
  }
  if (!entries.length) return { text: "", contributingSourceIds: [], truncated: false, perSource: [] };

  const result = buildFairDump(entries, { maxEntries: cap, maxChars });
  if (result.truncated) {
    logger.info(
      { sourceIds, maxChars: maxChars ?? null, maxEntries: cap, perSource: result.perSource, keptChars: result.text.length },
      "KB dump truncated (fair multi-source budget)",
    );
  }
  return result;
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
 * Load knowledge entries across MULTIPLE sources and format them as a single
 * prompt-injectable context block with FAIR per-source budgeting (entry cap
 * MAX_KB_ENTRIES; optional char cap). Used by the full-dump injection paths
 * (session start, webcall start). Returns metadata for the execution log.
 */
export async function buildKnowledgeBaseBlockEx(
  sourceIds: number[],
  maxChars?: number,
  excludeTitles?: string[],
): Promise<KbFairDumpResult> {
  const unique = Array.from(new Set(sourceIds.filter((n) => Number.isInteger(n))));
  if (!unique.length) return { text: "", contributingSourceIds: [], truncated: false, perSource: [] };
  return dumpEntries(unique, MAX_KB_ENTRIES, maxChars, excludeTitles);
}

/**
 * Back-compat string variant (no char cap) — delegates to
 * buildKnowledgeBaseBlockEx.
 */
export async function buildKnowledgeBaseBlock(sourceIds: number[]): Promise<string> {
  const res = await buildKnowledgeBaseBlockEx(sourceIds);
  return res.text;
}

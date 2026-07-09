import { db, knowledgeEntriesTable, agentKnowledgeSourcesTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

/**
 * Hard ceiling on KB entries sent to the LLM.
 * Beyond ~200 entries the context window gets overwhelmed and recall degrades.
 * Entries are fetched in DB insertion order; the most recently added entries
 * are excluded when the source exceeds this cap.
 */
const MAX_KB_ENTRIES = 200;

/** Format a single knowledge entry row into a prompt-injectable block. */
function formatEntry(e: { title?: string | null; content: string; keywords?: string | null }): string {
  const parts: string[] = [];
  if (e.title) parts.push(`Title: ${e.title}`);
  parts.push(`Content: ${e.content}`);
  if (e.keywords) parts.push(`Keywords: ${e.keywords}`);
  return parts.join("\n");
}

/**
 * Load knowledge entries for a source and format them as a prompt-injectable
 * context block.
 *
 * Strategy:
 * - When `query` is non-empty: use PostgreSQL FTS (`ts_rank_cd`) to rank
 *   entries by relevance to the query, returning the topK most relevant.
 *   Backed by a GIN index on `to_tsvector('english', title||content||keywords)`.
 * - When `query` is empty (session-start full-dump): return entries in
 *   insertion order up to MAX_KB_ENTRIES.
 *
 * `knowledgeSourceId` corresponds to `knowledge_sources.id`.
 * Returns an empty string when there are no entries so the caller skips injection.
 */
export async function retrieveKbContext(
  knowledgeSourceId: number,
  query: string,
  topK = 50,
): Promise<string> {
  const cap = Math.min(Math.max(topK, 10), MAX_KB_ENTRIES);
  try {
    const hasQuery = query.trim().length > 0;

    if (hasQuery) {
      // FTS-ranked retrieval — uses the GIN index for performance
      type FtsRow = { id: number; source_id: number; user_id: string; title: string | null; content: string; keywords: string | null; created_at: Date; rank: number };
      const rows = await db.execute<FtsRow>(sql`
        SELECT id, source_id, user_id, title, content, keywords, created_at,
          ts_rank_cd(
            to_tsvector('english',
              coalesce(title, '') || ' ' || content || ' ' || coalesce(keywords, '')
            ),
            plainto_tsquery('english', ${query.trim()})
          ) AS rank
        FROM knowledge_entries
        WHERE source_id = ${knowledgeSourceId}
          AND to_tsvector('english',
                coalesce(title, '') || ' ' || content || ' ' || coalesce(keywords, '')
              ) @@ plainto_tsquery('english', ${query.trim()})
        ORDER BY rank DESC, id ASC
        LIMIT ${cap}
      `);
      const entries = rows.rows as FtsRow[];
      if (!entries.length) return "";
      return entries.map(e => formatEntry({ title: e.title, content: e.content, keywords: e.keywords })).join("\n\n---\n\n");
    } else {
      // Full-dump (session-start) — no query to rank against
      const entries = await db
        .select()
        .from(knowledgeEntriesTable)
        .where(eq(knowledgeEntriesTable.sourceId, knowledgeSourceId))
        .limit(cap);
      if (!entries.length) return "";
      if (entries.length >= MAX_KB_ENTRIES) {
        logger.warn({ knowledgeSourceId, cap: MAX_KB_ENTRIES }, "KB entries capped at MAX_KB_ENTRIES");
      }
      return entries.map(e => formatEntry(e)).join("\n\n---\n\n");
    }
  } catch (err) {
    logger.warn({ err, knowledgeSourceId }, "KB context load failed");
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
  try {
    const entries = await db
      .select()
      .from(knowledgeEntriesTable)
      .where(inArray(knowledgeEntriesTable.sourceId, unique))
      .limit(MAX_KB_ENTRIES);

    if (!entries.length) return "";
    if (entries.length >= MAX_KB_ENTRIES) {
      logger.warn(
        { sourceIds: unique, cap: MAX_KB_ENTRIES },
        "Combined KB entries capped at MAX_KB_ENTRIES — some entries were not injected",
      );
    }

    return entries
      .map(e => {
        const parts: string[] = [];
        if (e.title) parts.push(`Title: ${e.title}`);
        parts.push(`Content: ${e.content}`);
        if (e.keywords) parts.push(`Keywords: ${e.keywords}`);
        return parts.join("\n");
      })
      .join("\n\n---\n\n");
  } catch (err) {
    logger.warn({ err, sourceIds: unique }, "Combined KB context load failed");
    return "";
  }
}

/**
 * Per-turn retrieval across MULTIPLE sources (pipeline use). Concatenates the
 * formatted blocks from each source, preserving each source's graceful-error
 * behavior (a failing source contributes "" and is skipped).
 */
export async function retrieveKbContextMulti(
  sourceIds: number[],
  query: string,
  topK = 50,
): Promise<string> {
  const unique = Array.from(new Set(sourceIds.filter((n) => Number.isInteger(n))));
  if (!unique.length) return "";
  const blocks = await Promise.all(unique.map((id) => retrieveKbContext(id, query, topK)));
  return blocks.filter((b) => b.length > 0).join("\n\n---\n\n");
}

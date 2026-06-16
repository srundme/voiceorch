import { db, knowledgeEntriesTable, agentKnowledgeSourcesTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "../lib/logger.js";

/**
 * Hard ceiling on KB entries sent to the LLM.
 * Beyond ~200 entries the context window gets overwhelmed and recall degrades.
 * Entries are fetched in DB insertion order; the most recently added entries
 * are excluded when the source exceeds this cap.
 */
const MAX_KB_ENTRIES = 200;

/**
 * Load all knowledge entries for a source and format them as a
 * prompt-injectable context block.
 *
 * Strategy: pass every entry to the agent's LLM — no keyword matching,
 * no FTS, no stemming. The LLM reads everything and selects what's
 * relevant. Reliable for sources up to ~200 entries.
 *
 * `knowledgeSourceId` corresponds to `knowledge_sources.id`.
 * Returns an empty string when there are no entries so the caller skips injection.
 */
export async function retrieveKbContext(
  knowledgeSourceId: number,
  _query: string,
  topK = 50,
): Promise<string> {
  try {
    const entries = await db
      .select()
      .from(knowledgeEntriesTable)
      .where(eq(knowledgeEntriesTable.sourceId, knowledgeSourceId))
      .limit(Math.min(Math.max(topK, 50), MAX_KB_ENTRIES));

    if (!entries.length) return "";

    if (entries.length >= MAX_KB_ENTRIES) {
      logger.warn(
        { knowledgeSourceId, cap: MAX_KB_ENTRIES },
        "KB entries capped at MAX_KB_ENTRIES — source has more entries than were injected into the prompt",
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

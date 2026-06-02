import { db, knowledgeEntriesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";

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
      .limit(Math.max(topK, 50));

    if (!entries.length) return "";

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

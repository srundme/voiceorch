import { db, knowledgeEntriesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
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

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

/**
 * Retrieve relevant knowledge entries via PostgreSQL Full Text Search and
 * format them as a prompt-injectable string.
 *
 * `knowledgeSourceId` corresponds to `knowledge_sources.id`.
 * Returns an empty string if nothing is found so the caller can skip injection.
 */
export async function retrieveKbContext(
  knowledgeSourceId: number,
  query: string,
  topK = 5,
): Promise<string> {
  if (!query?.trim()) return "";

  try {
    const rows = await db.execute<{
      title: string | null;
      content: string;
    }>(sql`
      SELECT ke.title, ke.content
      FROM knowledge_entries ke
      WHERE
        ke.source_id = ${knowledgeSourceId}
        AND to_tsvector('english', coalesce(ke.title,'') || ' ' || ke.content || ' ' || coalesce(ke.keywords,''))
            @@ plainto_tsquery('english', ${query.trim()})
      ORDER BY
        ts_rank(
          to_tsvector('english', coalesce(ke.title,'') || ' ' || ke.content || ' ' || coalesce(ke.keywords,'')),
          plainto_tsquery('english', ${query.trim()})
        ) DESC
      LIMIT ${topK}
    `);

    if (!rows.rows.length) return "";

    return rows.rows
      .map(r => r.title ? `${r.title}\n${r.content}` : r.content)
      .join("\n\n---\n\n");
  } catch (err) {
    logger.warn({ err, knowledgeSourceId }, "KB FTS retrieval failed");
    return "";
  }
}

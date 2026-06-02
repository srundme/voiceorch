import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const STOP_WORDS = new Set([
  'what','when','where','which','who','whom','whose','how','why',
  'is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might',
  'shall','can','the','a','an','and','or','but','in','on','at',
  'to','for','of','with','by','from','about','into','its','your',
  'our','their','this','that','these','those','tell','me','my',
  'you','he','she','it','we','they','them','please','give','find',
]);

function significantWords(query: string): string[] {
  return query.trim().toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^a-z0-9₹]/g, ''))
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Retrieve relevant knowledge entries via PostgreSQL Full Text Search and
 * format them as a prompt-injectable string.
 *
 * Pass 1 — strict FTS (AND: every word must appear in the entry).
 * Pass 2 — broad ILIKE fallback on significant words (OR) when FTS returns nothing.
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
    const q = query.trim();

    // Pass 1 — strict FTS (AND)
    const ftsRows = await db.execute<{ title: string | null; content: string }>(sql`
      SELECT ke.title, ke.content
      FROM knowledge_entries ke
      WHERE
        ke.source_id = ${knowledgeSourceId}
        AND to_tsvector('english', coalesce(ke.title,'') || ' ' || ke.content || ' ' || coalesce(ke.keywords,''))
            @@ plainto_tsquery('english', ${q})
      ORDER BY
        ts_rank(
          to_tsvector('english', coalesce(ke.title,'') || ' ' || ke.content || ' ' || coalesce(ke.keywords,'')),
          plainto_tsquery('english', ${q})
        ) DESC
      LIMIT ${topK}
    `);

    if (ftsRows.rows.length) {
      return ftsRows.rows
        .map(r => r.title ? `${r.title}\n${r.content}` : r.content)
        .join("\n\n---\n\n");
    }

    // Pass 2 — broad fallback: ILIKE on any significant word (OR)
    const words = significantWords(q);
    if (!words.length) return "";

    const conditions = words.flatMap(w => [
      sql`lower(ke.content) LIKE ${'%' + w + '%'}`,
      sql`lower(coalesce(ke.title,'')) LIKE ${'%' + w + '%'}`,
      sql`lower(coalesce(ke.keywords,'')) LIKE ${'%' + w + '%'}`,
    ]);
    const orClause = conditions.reduce((acc, c) => sql`${acc} OR ${c}`);

    const broadRows = await db.execute<{ title: string | null; content: string }>(sql`
      SELECT ke.title, ke.content
      FROM knowledge_entries ke
      WHERE ke.source_id = ${knowledgeSourceId}
        AND (${orClause})
      LIMIT ${topK}
    `);

    if (!broadRows.rows.length) return "";

    return broadRows.rows
      .map(r => r.title ? `${r.title}\n${r.content}` : r.content)
      .join("\n\n---\n\n");

  } catch (err) {
    logger.warn({ err, knowledgeSourceId }, "KB retrieval failed");
    return "";
  }
}

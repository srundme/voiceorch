import { db, knowledgeSourcesTable, knowledgeEntriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { isKbVectorReady, kickKbEmbedWorker } from "./kb-embeddings.js";
import { kickKrutrimSummaryWorker } from "./kb-source-summary.js";

export type KbEntryInput = { title?: string; content: string; keywords?: string };

export type IngestKbTextParams = {
  userId: string;
  sourceName: string;
  /** "text" or "faq" — determines source.type in DB */
  type: "text" | "faq";
  entries: KbEntryInput[];
  /**
   * If supplied, update this existing source in-place (Vibe Builder upsert path).
   * Existing entries are updated/extended/pruned to match `entries`.
   * If not supplied, a new source is always created.
   */
  existingSourceId?: number;
};

export type IngestKbTextResult = {
  sourceId: number;
  entryCount: number;
};

/**
 * Shared text/FAQ knowledge source ingestion service.
 *
 * Used by both the manual `POST /knowledge-sources` API route and the Vibe
 * Builder `knowledge_base` SSE phase, ensuring both flows share identical
 * lifecycle semantics and DB operations.
 *
 * Lifecycle: processing → ready (at least one entry indexed) | failed (no
 * valid entries, or a hard DB error).
 *
 * When `existingSourceId` is provided the source is updated in-place:
 * - Existing entries at matching positions are updated (content/title/keywords).
 * - Additional new entries are appended.
 * - Surplus old entries (beyond the new list length) are deleted.
 * - Status is reset to processing, then advanced to ready/failed on completion.
 */
export async function ingestKbTextEntries(params: IngestKbTextParams): Promise<IngestKbTextResult> {
  const { userId, sourceName, type, entries, existingSourceId } = params;
  const validEntries = entries.filter(e => e.content?.trim());

  let sourceId: number;

  if (existingSourceId != null) {
    sourceId = existingSourceId;
    await db.update(knowledgeSourcesTable)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(knowledgeSourcesTable.id, sourceId));
  } else {
    const [source] = await db
      .insert(knowledgeSourcesTable)
      .values({ userId, name: sourceName, type, status: "processing", entryCount: 0 })
      .returning();
    sourceId = source!.id;
  }

  if (!validEntries.length) {
    await db.update(knowledgeSourcesTable)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(knowledgeSourcesTable.id, sourceId))
      .catch(() => {});
    return { sourceId, entryCount: 0 };
  }

  try {
    // Fetch existing entry IDs in deterministic order so position-based upsert is stable
    const existingRows = await db
      .select({ id: knowledgeEntriesTable.id })
      .from(knowledgeEntriesTable)
      .where(eq(knowledgeEntriesTable.sourceId, sourceId))
      .orderBy(knowledgeEntriesTable.id);

    let upserted = 0;
    for (let i = 0; i < validEntries.length; i++) {
      const e = validEntries[i]!;
      const existing = existingRows[i];
      if (existing) {
        await db.update(knowledgeEntriesTable)
          .set({
            title: e.title?.trim() || null,
            content: e.content.trim(),
            keywords: e.keywords?.trim() || null,
            // Content may have changed — reset the semantic vector so the
            // embed worker re-embeds. Gated: on DBs without pgvector the
            // embedding column doesn't exist and referencing it would error.
            ...(isKbVectorReady() ? { embedding: null, embeddingModel: null, embeddedAt: null } : {}),
          })
          .where(eq(knowledgeEntriesTable.id, existing.id));
      } else {
        await db.insert(knowledgeEntriesTable).values({
          sourceId,
          userId,
          title: e.title?.trim() || null,
          content: e.content.trim(),
          keywords: e.keywords?.trim() || null,
        });
      }
      upserted++;
    }

    // Prune surplus old entries (e.g., user removed FAQ rows on a second Vibe turn)
    if (existingRows.length > validEntries.length) {
      const surplus = existingRows.slice(validEntries.length);
      for (const row of surplus) {
        await db.delete(knowledgeEntriesTable)
          .where(eq(knowledgeEntriesTable.id, row.id))
          .catch(() => {});
      }
    }

    await db.update(knowledgeSourcesTable)
      .set({ status: "ready", entryCount: upserted, updatedAt: new Date() })
      .where(eq(knowledgeSourcesTable.id, sourceId));

    logger.info({ sourceId, type, entryCount: upserted }, "KB text/FAQ source ingested");
    kickKbEmbedWorker();
    kickKrutrimSummaryWorker();
    return { sourceId, entryCount: upserted };
  } catch (err) {
    logger.warn({ err, sourceId }, "ingestKbTextEntries: failed");
    await db.update(knowledgeSourcesTable)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(knowledgeSourcesTable.id, sourceId))
      .catch(() => {});
    throw err;
  }
}

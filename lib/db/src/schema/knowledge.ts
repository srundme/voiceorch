import {
  pgTable, text, serial, timestamp, integer, primaryKey, vector, index, boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { agentsTable } from "./agents";

/* ── knowledge_sources ────────────────────────────────────────────────────── */

export const knowledgeSourcesTable = pgTable("knowledge_sources", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().default("text"),  // 'faq' | 'text' | 'website' | 'file'
  status: text("status").notNull().default("active"), // 'active' | 'processing' | 'error'
  entryCount: integer("entry_count").notNull().default(0),
  /**
   * Content hash (sha256 of all entry contents, sorted by id) captured the
   * last time the Krutrim auto-summary was generated for this source.
   * NULL = never generated. Compared on each sweep (kb-source-summary.ts);
   * a mismatch means entries changed since the last summary and it must be
   * regenerated. Scoped to Krutrim because that's the only provider whose
   * baked-KB cap (4000 chars, no confirmed prefix caching — see replit.md)
   * needs a compressed pinned summary to cover a large KB within budget.
   */
  krutrimSummaryHash: text("krutrim_summary_hash"),
  /**
   * JSON array of page URLs that failed during the last website crawl.
   * Used by retry-crawl and the Needs-attention UI. NULL for non-website sources.
   */
  crawlFailedUrls: text("crawl_failed_urls"),
  /**
   * Human-readable reason the last import failed (e.g. scanned/encrypted PDF).
   * Shown on the failed-pack banner. NULL when the source is healthy.
   */
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/* ── knowledge_entries ────────────────────────────────────────────────────── */

export const knowledgeEntriesTable = pgTable("knowledge_entries", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull().references(() => knowledgeSourcesTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  title: text("title"),
  content: text("content").notNull(),
  keywords: text("keywords"),
  /**
   * Multilingual semantic embedding (jina-embeddings-v3 @ 768 dims,
   * L2-normalized). NULL = not yet embedded — the KB embed worker
   * back-fills NULL rows; every content write must reset this to NULL.
   * Column exists only when the pgvector extension is available (migration
   * 0045 soft-fails without it); runtime code gates on isKbVectorReady().
   */
  embedding: vector("embedding", { dimensions: 768 }),
  embeddingModel: text("embedding_model"),
  embeddedAt: timestamp("embedded_at", { withTimezone: true }),
  /**
   * Pinned entries sort FIRST in full-dump injection paths (dumpEntries in
   * kb-retrieval.ts): the call-start baked block and the per-turn prefetch
   * fallback both lead with pinned content (e.g. a curated KB summary) before
   * regular insertion-order entries. Shipped via migration 0048.
   */
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  embeddingHnsw: index("knowledge_entries_embedding_hnsw").using("hnsw", t.embedding.op("vector_cosine_ops")),
  // FTS GIN index (originally migration 0044). Declared here too so
  // drizzle-kit push doesn't drop it as an "unknown" index in dev.
  ftsIdx: index("knowledge_entries_fts_idx").using(
    "gin",
    sql`to_tsvector('english', coalesce(${t.title}, '') || ' ' || ${t.content} || ' ' || coalesce(${t.keywords}, ''))`,
  ),
}));

/* ── agent_knowledge_sources (M:N agent ↔ knowledge_source) ───────────────── */

export const agentKnowledgeSourcesTable = pgTable("agent_knowledge_sources", {
  agentId: integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  sourceId: integer("source_id").notNull().references(() => knowledgeSourcesTable.id, { onDelete: "cascade" }),
}, (t) => ({
  pk: primaryKey({ name: "agent_ks_pk", columns: [t.agentId, t.sourceId] }),
}));

/* ── Zod schemas ──────────────────────────────────────────────────────────── */

export const insertKnowledgeSourceSchema = createInsertSchema(knowledgeSourcesTable).omit({
  id: true, createdAt: true, updatedAt: true, entryCount: true,
});

export const insertKnowledgeEntrySchema = createInsertSchema(knowledgeEntriesTable).omit({
  id: true, createdAt: true, embedding: true, embeddingModel: true, embeddedAt: true,
});

export type KnowledgeSource = typeof knowledgeSourcesTable.$inferSelect;
export type KnowledgeEntry = typeof knowledgeEntriesTable.$inferSelect;
export type InsertKnowledgeSource = z.infer<typeof insertKnowledgeSourceSchema>;
export type InsertKnowledgeEntry = z.infer<typeof insertKnowledgeEntrySchema>;

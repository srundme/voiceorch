import {
  pgTable, text, serial, timestamp, integer, primaryKey, vector, index,
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
   * Multilingual semantic embedding (gemini-embedding-001, MRL-truncated to 768
   * dims and re-normalized). NULL = not yet embedded — the KB embed worker
   * back-fills NULL rows; every content write must reset this to NULL.
   * Column exists only when the pgvector extension is available (migration
   * 0045 soft-fails without it); runtime code gates on isKbVectorReady().
   */
  embedding: vector("embedding", { dimensions: 768 }),
  embeddingModel: text("embedding_model"),
  embeddedAt: timestamp("embedded_at", { withTimezone: true }),
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

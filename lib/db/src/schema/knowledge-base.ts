import {
  pgTable, text, serial, timestamp, integer, json,
} from "drizzle-orm/pg-core";
import { customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ── pgvector custom type ─────────────────────────────────────────────────── */

export const embedding = customType<{
  data: number[];
  config: { dimensions: number };
  driverData: string;
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1536})`;
  },
  fromDriver(value: string): number[] {
    // pgvector returns "[0.1,0.2,...]" format
    return value.slice(1, -1).split(",").map(Number);
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
});

/* ── knowledge_bases ──────────────────────────────────────────────────────── */

export const knowledgeBasesTable = pgTable("knowledge_bases", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  name: text("name").notNull(),
  description: text("description"),
  embeddingModel: text("embedding_model").notNull().default("text-embedding-3-small"),
  chunkSize: integer("chunk_size").notNull().default(512),
  chunkOverlap: integer("chunk_overlap").notNull().default(64),
  documentCount: integer("document_count").notNull().default(0),
  chunkCount: integer("chunk_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/* ── kb_documents ─────────────────────────────────────────────────────────── */

export const kbDocumentsTable = pgTable("kb_documents", {
  id: serial("id").primaryKey(),
  knowledgeBaseId: integer("knowledge_base_id")
    .notNull()
    .references(() => knowledgeBasesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sourceType: text("source_type").notNull(), // "text" | "url"
  sourceUrl: text("source_url"),
  charCount: integer("char_count"),
  status: text("status").notNull().default("pending"), // pending | processing | ready | error
  processingError: text("processing_error"),
  chunkCount: integer("chunk_count"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/* ── kb_chunks ────────────────────────────────────────────────────────────── */

export const kbChunksTable = pgTable("kb_chunks", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id")
    .notNull()
    .references(() => kbDocumentsTable.id, { onDelete: "cascade" }),
  knowledgeBaseId: integer("knowledge_base_id")
    .notNull()
    .references(() => knowledgeBasesTable.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  tokenCount: integer("token_count"),
  chunkEmbedding: embedding("embedding", { dimensions: 1536 }),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Zod schemas ──────────────────────────────────────────────────────────── */

export const insertKbSchema = createInsertSchema(knowledgeBasesTable).omit({
  id: true, createdAt: true, updatedAt: true, documentCount: true, chunkCount: true,
});

export const insertKbDocumentSchema = createInsertSchema(kbDocumentsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export type KnowledgeBase = typeof knowledgeBasesTable.$inferSelect;
export type KbDocument = typeof kbDocumentsTable.$inferSelect;
export type KbChunk = typeof kbChunksTable.$inferSelect;
export type InsertKnowledgeBase = z.infer<typeof insertKbSchema>;

import {
  pgTable, text, serial, timestamp, integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ── knowledge_sources ────────────────────────────────────────────────────── */

export const knowledgeSourcesTable = pgTable("knowledge_sources", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().default("text"),  // 'faq' | 'text' | 'website'
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Zod schemas ──────────────────────────────────────────────────────────── */

export const insertKnowledgeSourceSchema = createInsertSchema(knowledgeSourcesTable).omit({
  id: true, createdAt: true, updatedAt: true, entryCount: true,
});

export const insertKnowledgeEntrySchema = createInsertSchema(knowledgeEntriesTable).omit({
  id: true, createdAt: true,
});

export type KnowledgeSource = typeof knowledgeSourcesTable.$inferSelect;
export type KnowledgeEntry = typeof knowledgeEntriesTable.$inferSelect;
export type InsertKnowledgeSource = z.infer<typeof insertKnowledgeSourceSchema>;
export type InsertKnowledgeEntry = z.infer<typeof insertKnowledgeEntrySchema>;

import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";

export const promptTemplatesTable = pgTable("prompt_templates", {
  id: serial("id").primaryKey(),
  version: integer("version").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  extractedText: text("extracted_text").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  isActive: boolean("is_active").notNull().default(false),
});

export type PromptTemplate = typeof promptTemplatesTable.$inferSelect;
export type InsertPromptTemplate = typeof promptTemplatesTable.$inferInsert;

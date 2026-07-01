import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";

/**
 * Dynamic, admin-managed domains (Real Estate, Insurance, Education, …).
 * Each domain owns an independent version history in `systemPromptTemplatesTable`.
 * Nothing here is hardcoded — domains are pure data.
 */
export const systemPromptDomainsTable = pgTable("system_prompt_domains", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SystemPromptDomain = typeof systemPromptDomainsTable.$inferSelect;
export type InsertSystemPromptDomain = typeof systemPromptDomainsTable.$inferInsert;

/**
 * Three layers of the SnapServe Prompting Framework:
 *  - "foundation"      — singleton group (domainId always null)
 *  - "client_details"  — singleton group (domainId always null)
 *  - "domain"          — one group per row in systemPromptDomainsTable (domainId set)
 *
 * Each group keeps its own version history + a single active version.
 * This is a NEW, separate store from `prompt_templates` (the legacy master
 * template that still powers live agent generation) — it is deliberately kept
 * independent so existing generation is unaffected.
 */
export const systemPromptTemplatesTable = pgTable("system_prompt_templates", {
  id: serial("id").primaryKey(),
  templateType: text("template_type").notNull(), // 'foundation' | 'client_details' | 'domain'
  domainId: integer("domain_id"), // FK -> system_prompt_domains.id, null for singletons
  version: integer("version").notNull(), // version WITHIN its group
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  extractedText: text("extracted_text").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  isActive: boolean("is_active").notNull().default(false),
});

export type SystemPromptTemplate = typeof systemPromptTemplatesTable.$inferSelect;
export type InsertSystemPromptTemplate = typeof systemPromptTemplatesTable.$inferInsert;

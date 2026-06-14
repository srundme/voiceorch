import { pgTable, serial, integer, index } from "drizzle-orm/pg-core";
import { callerFactsTable } from "./callerFacts";
import { callerSentencesTable } from "./callerSentences";

/**
 * Junction table: fact_sources edges — L0 fact → L2 sentence
 *
 * Replaces the comma-separated caller_facts.source_sentence_ids column.
 * Fully indexed so lookups by fact or by sentence are O(log n).
 */
export const callerFactSentenceLinksTable = pgTable("caller_fact_sentence_links", {
  id:         serial("id").primaryKey(),
  factId:     integer("fact_id").references(() => callerFactsTable.id, { onDelete: "cascade" }).notNull(),
  sentenceId: integer("sentence_id").references(() => callerSentencesTable.id, { onDelete: "cascade" }).notNull(),
}, (t) => [
  index("cfs_links_fact_idx").on(t.factId),
  index("cfs_links_sentence_idx").on(t.sentenceId),
]);

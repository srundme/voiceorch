import { pgTable, serial, integer, index } from "drizzle-orm/pg-core";
import { callerCallArchiveTable } from "./callerCallArchive";
import { callerFactsTable } from "./callerFacts";

/**
 * Junction table: insight_facts edges — L1 episode → L0 fact
 *
 * Replaces the comma-separated caller_call_archive.insight_fact_ids column.
 * Fully indexed so lookups by episode or by fact are O(log n).
 */
export const callerEpisodeFactLinksTable = pgTable("caller_episode_fact_links", {
  id:        serial("id").primaryKey(),
  episodeId: integer("episode_id").references(() => callerCallArchiveTable.id, { onDelete: "cascade" }).notNull(),
  factId:    integer("fact_id").references(() => callerFactsTable.id, { onDelete: "cascade" }).notNull(),
}, (t) => [
  index("cef_links_episode_idx").on(t.episodeId),
  index("cef_links_fact_idx").on(t.factId),
]);

import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { callerCallArchiveTable } from "./callerCallArchive";

/**
 * Sentence nodes — L2 in the Graphiti-style memory graph.
 *
 * One row per utterance in a call.
 * Ordered by sequence_num within an episode (NEXT edges).
 * Facts link back to sentences via caller_facts.source_sentence_ids (fact_sources provenance).
 */
export const callerSentencesTable = pgTable("caller_sentences", {
  id:          serial("id").primaryKey(),
  episodeId:   integer("episode_id").references(() => callerCallArchiveTable.id, { onDelete: "cascade" }).notNull(),
  sequenceNum: integer("sequence_num").notNull(),
  speaker:     text("speaker").notNull(),   // 'agent' | 'caller'
  text:        text("text").notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("caller_sentences_episode_idx").on(t.episodeId, t.sequenceNum),
]);

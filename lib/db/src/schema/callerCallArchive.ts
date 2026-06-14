import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

/**
 * Full transcript archive — one row per call, never deleted.
 * Provides the raw material for retrieval-augmented memory:
 * future calls can search/fetch past transcripts to recall specific details.
 */
export const callerCallArchiveTable = pgTable("caller_call_archive", {
  id:              serial("id").primaryKey(),
  agentId:         integer("agent_id").references(() => agentsTable.id, { onDelete: "cascade" }).notNull(),
  phoneNumber:     text("phone_number").notNull(),
  callId:          integer("call_id"),
  transcript:      text("transcript").notNull(),
  summary:         text("summary"),
  durationSeconds: integer("duration_seconds"),
  factsExtracted:  boolean("facts_extracted").default(false).notNull(),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("caller_call_archive_lookup_idx").on(t.agentId, t.phoneNumber),
]);

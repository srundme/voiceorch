import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

/**
 * Episode nodes — L1 in the Graphiti-style memory graph.
 *
 * One row per call, never deleted.
 * Which L0 facts were synthesised from this episode is tracked in the
 * caller_episode_fact_links junction table (insight_facts edges: L1 → L0).
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
  sentiment:       text("sentiment"),  // "positive" | "neutral" | "negative" | "frustrated" | "resolved"
  createdAt:       timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("caller_call_archive_lookup_idx").on(t.agentId, t.phoneNumber),
]);

import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

/**
 * Episode nodes — L1 in the Graphiti-style memory graph.
 *
 * One row per call, never deleted.
 * insight_fact_ids tracks which L0 fact nodes were synthesized from this episode
 * (insight_facts edges: L0→L1 in graph notation).
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
  /** Comma-separated caller_facts.id values — insight_facts edges (L1→L0) */
  insightFactIds:  text("insight_fact_ids").notNull().default(""),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("caller_call_archive_lookup_idx").on(t.agentId, t.phoneNumber),
]);

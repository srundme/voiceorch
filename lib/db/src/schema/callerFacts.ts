import { pgTable, serial, integer, text, real, timestamp, index } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

/**
 * Append-only atomic fact nodes — L0 in the Graphiti-style memory graph.
 *
 * Conflict resolution via supersession:
 *   When a fact is updated, a new row is inserted and the old row's
 *   superseded_by_id is set to the new row's id.
 *   "Current" facts are those WHERE superseded_by_id IS NULL.
 *
 * Provenance via fact_sources:
 *   source_sentence_ids tracks which L2 sentence nodes produced this fact.
 *   source_call_id is the call from which the fact was extracted.
 */
export const callerFactsTable = pgTable("caller_facts", {
  id:                serial("id").primaryKey(),
  agentId:           integer("agent_id").references(() => agentsTable.id, { onDelete: "cascade" }).notNull(),
  phoneNumber:       text("phone_number").notNull(),
  key:               text("key").notNull(),
  value:             text("value").notNull(),
  confidence:        real("confidence").notNull().default(1.0),
  sourceCallId:      integer("source_call_id"),
  /** Comma-separated caller_sentences.id values — fact_sources provenance (L0→L2) */
  sourceSentenceIds: text("source_sentence_ids").notNull().default(""),
  /** FK → caller_facts.id — superseded_by edge for conflict resolution */
  supersededById:    integer("superseded_by_id").references((): AnyPgColumn => callerFactsTable.id),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("caller_facts_lookup_idx").on(t.agentId, t.phoneNumber),
  index("caller_facts_key_idx").on(t.agentId, t.phoneNumber, t.key),
  index("caller_facts_active_idx").on(t.agentId, t.phoneNumber, t.supersededById),
]);

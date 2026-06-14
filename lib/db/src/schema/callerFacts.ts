import { pgTable, serial, integer, text, real, timestamp, index } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

/**
 * Append-only structured facts extracted per caller across all their calls.
 * Facts are never overwritten — each extraction adds new rows.
 * Query the most-recent row per key to get the current "best known" value.
 */
export const callerFactsTable = pgTable("caller_facts", {
  id:           serial("id").primaryKey(),
  agentId:      integer("agent_id").references(() => agentsTable.id, { onDelete: "cascade" }).notNull(),
  phoneNumber:  text("phone_number").notNull(),
  key:          text("key").notNull(),
  value:        text("value").notNull(),
  confidence:   real("confidence").notNull().default(1.0),
  sourceCallId: integer("source_call_id"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("caller_facts_lookup_idx").on(t.agentId, t.phoneNumber),
  index("caller_facts_key_idx").on(t.agentId, t.phoneNumber, t.key),
]);

import { pgTable, serial, integer, text, real, timestamp, index } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";
import { callsTable } from "./calls";

/**
 * Mid-call fact candidates (design §2).
 *
 * Regex / fast latches write here for in-call personalization only.
 * Never treated as ground truth — call-end extraction + validation gate
 * decide what enters caller_facts.
 */
export const pendingCallerFactsTable = pgTable("pending_caller_facts", {
  id:               serial("id").primaryKey(),
  callId:           integer("call_id").references(() => callsTable.id, { onDelete: "cascade" }).notNull(),
  agentId:          integer("agent_id").references(() => agentsTable.id, { onDelete: "cascade" }).notNull(),
  phoneNumber:      text("phone_number").notNull(),
  key:              text("key").notNull(),
  valueRaw:         text("value_raw").notNull(),
  sourceSentenceId: integer("source_sentence_id"),
  method:           text("method").notNull().default("regex"), // 'regex' | 'name_latch'
  confidence:       real("confidence").notNull().default(0.4),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("pending_caller_facts_call_idx").on(t.callId),
  index("pending_caller_facts_lookup_idx").on(t.agentId, t.phoneNumber, t.callId),
]);

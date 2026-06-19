import { pgTable, text, serial, integer, timestamp, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * TRAI (Telecom Regulatory Authority of India) compliance tables.
 * ─────────────────────────────────────────────────────────────────────────────
 * Independent from the campaign DNC list (workspace_dnc). The suppression list
 * is platform-wide and populated by caller opt-out detection (or seeded manually
 * in the DB). The compliance log records pre-dial decisions and opt-out events.
 */

/**
 * Numbers that must not be dialed by TRAI-enabled agents.
 *   status: "full_dnd" | "opted_out"
 *   source: where the suppression originated (e.g. "opt_out_detected", "manual")
 */
export const traiSuppressionListTable = pgTable(
  "trai_suppression_list",
  {
    id:              serial("id").primaryKey(),
    phoneNumber:     text("phone_number").notNull(),
    status:          text("status").notNull(),
    categoryBlocked: text("category_blocked"),
    source:          text("source"),
    addedAt:         timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("trai_suppression_phone_idx").on(t.phoneNumber)],
);

export type TraiSuppressionEntry = typeof traiSuppressionListTable.$inferSelect;
export type InsertTraiSuppressionEntry = typeof traiSuppressionListTable.$inferInsert;

/**
 * Audit log of TRAI pre-dial checks and post-call opt-out detections.
 *   preDialStatus: "allowed" | "blocked" | null (null for post-call-only rows)
 *   blockReason:   human-readable reason when blocked
 *   optOutDetected: true when a caller opt-out phrase was detected post-call
 */
export const traiCallComplianceLogTable = pgTable(
  "trai_call_compliance_log",
  {
    id:            serial("id").primaryKey(),
    agentId:       integer("agent_id"),
    callId:        integer("call_id"),
    phoneNumber:   text("phone_number").notNull(),
    preDialStatus: text("pre_dial_status"),
    blockReason:   text("block_reason"),
    optOutDetected: boolean("opt_out_detected").notNull().default(false),
    createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("trai_compliance_log_agent_idx").on(t.agentId),
    index("trai_compliance_log_phone_idx").on(t.phoneNumber),
  ],
);

export type TraiCallComplianceLog = typeof traiCallComplianceLogTable.$inferSelect;
export type InsertTraiCallComplianceLog = typeof traiCallComplianceLogTable.$inferInsert;

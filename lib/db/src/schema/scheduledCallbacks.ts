import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";
import { callsTable } from "./calls";
import { campaignLeadsTable } from "./campaigns";

export const scheduledCallbacksTable = pgTable("scheduled_callbacks", {
  id:                    serial("id").primaryKey(),
  agentId:               integer("agent_id").references(() => agentsTable.id, { onDelete: "cascade" }).notNull(),
  toNumber:              text("to_number").notNull(),
  userId:                text("user_id"),
  scheduledAt:           timestamp("scheduled_at").notNull(),
  createdFromCallId:     integer("created_from_call_id").references(() => callsTable.id, { onDelete: "set null" }),
  campaignLeadId:        integer("campaign_lead_id").references(() => campaignLeadsTable.id, { onDelete: "set null" }),
  status:                text("status").notNull().default("pending"), // pending | triggering | triggered | failed | cancelled
  triggeredAt:           timestamp("triggered_at"),
  createdAt:             timestamp("created_at").defaultNow().notNull(),
  // ── Auto-redial fields ────────────────────────────────────────────────────────
  reason:                text("reason").default("callback_requested"), // callback_requested | no_answer
  attemptCount:          integer("attempt_count").notNull().default(1),
  maxAttempts:           integer("max_attempts").notNull().default(5),
  redialIntervalMinutes: integer("redial_interval_minutes").notNull().default(30),
  cancelledAt:           timestamp("cancelled_at"),
  notes:                 text("notes"),
});

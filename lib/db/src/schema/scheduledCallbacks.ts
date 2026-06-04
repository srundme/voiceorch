import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";
import { callsTable } from "./calls";
import { campaignLeadsTable } from "./campaigns";

export const scheduledCallbacksTable = pgTable("scheduled_callbacks", {
  id:                serial("id").primaryKey(),
  agentId:           integer("agent_id").references(() => agentsTable.id, { onDelete: "cascade" }).notNull(),
  toNumber:          text("to_number").notNull(),
  userId:            text("user_id"),  // Clerk userId — set for webcall callbacks so SSE can route to the right browser
  scheduledAt:       timestamp("scheduled_at").notNull(),
  createdFromCallId: integer("created_from_call_id").references(() => callsTable.id, { onDelete: "set null" }),
  campaignLeadId:    integer("campaign_lead_id").references(() => campaignLeadsTable.id, { onDelete: "set null" }),
  status:            text("status").notNull().default("pending"),  // pending | triggering | triggered | failed
  triggeredAt:       timestamp("triggered_at"),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
});

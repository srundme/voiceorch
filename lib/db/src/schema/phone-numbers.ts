import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";
import { usersTable } from "./users";

export const phoneNumbersTable = pgTable("phone_numbers", {
  id:            serial("id").primaryKey(),
  userId:        text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
  number:        text("number").notNull().unique(),
  countryCode:   text("country_code").notNull(),
  region:        text("region"),
  numberType:    text("number_type").notNull().default("local"),
  vobizNumberId: text("vobiz_number_id"),
  agentId:       integer("agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
  /** When set, inbound calls create/join a Squad live run (entry member answers). */
  squadId:       integer("squad_id"),
  status:        text("status").notNull().default("active"),
  monthlyRateCents: integer("monthly_rate_cents").notNull().default(0),
  // Recurring monthly renewal charge (billed on the purchase-date anniversary,
  // i.e. exactly 30 days after purchasedAt / lastRenewalAt — NOT calendar month).
  renewalRateCents: integer("renewal_rate_cents").notNull().default(800), // $8.00 USD
  nextRenewalAt: timestamp("next_renewal_at", { withTimezone: true }),
  lastRenewalAt: timestamp("last_renewal_at", { withTimezone: true }),
  purchasedAt:   timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
  releasedAt:    timestamp("released_at", { withTimezone: true }),
  createdAt:     timestamp("created_at",  { withTimezone: true }).notNull().defaultNow(),
  // P2-F: Inbound routing rules (evaluated top-to-bottom, first match wins)
  routingRules:  jsonb("routing_rules").$type<Array<{
    condition: "caller_prefix" | "time_range" | "always";
    value?: string;
    startHour?: number;
    endHour?: number;
    targetAgentId: number;
  }>>(),
});

export type PhoneNumber = typeof phoneNumbersTable.$inferSelect;
export type InsertPhoneNumber = typeof phoneNumbersTable.$inferInsert;

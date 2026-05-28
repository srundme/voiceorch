import { pgTable, text, serial, timestamp, bigint, uniqueIndex } from "drizzle-orm/pg-core";

// Allocations track total budget for a (service, provider) pair.
// allocatedCostMicros: total budget in USD micros for the period.
// workspaceId nullable = global allocation.
export const providerAllocationsTable = pgTable(
  "provider_allocations",
  {
    id: serial("id").primaryKey(),
    service: text("service").notNull(),
    provider: text("provider").notNull(),
    workspaceId: text("workspace_id"), // null = global
    allocatedCostMicros: bigint("allocated_cost_micros", { mode: "number" }).notNull().default(0),
    lowBalanceThresholdMicros: bigint("low_balance_threshold_micros", { mode: "number" }).notNull().default(0),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("provider_allocations_uniq_idx").on(t.service, t.provider, t.workspaceId),
  }),
);

export type ProviderAllocation = typeof providerAllocationsTable.$inferSelect;
export type InsertProviderAllocation = typeof providerAllocationsTable.$inferInsert;

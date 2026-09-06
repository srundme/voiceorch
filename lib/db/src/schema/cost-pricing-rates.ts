import { pgTable, text, serial, timestamp, numeric, index } from "drizzle-orm/pg-core";

/**
 * Effective-dated provider cost rates (Admin V2).
 * Never overwrite historical rows — close prior open row (effective_to) then insert new.
 * Rate is stored as a decimal string in the billing unit's currency (default INR).
 */
export const providerCostRatesTable = pgTable(
  "provider_cost_rates",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(),
    service: text("service").notNull(), // telephony | stt | tts | llm | other
    billingUnit: text("billing_unit").notNull(), // per_minute | per_second | per_token | ...
    rate: numeric("rate", { precision: 18, scale: 6 }).notNull(),
    currency: text("currency").notNull().default("INR"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdBy: text("created_by"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("provider_cost_rates_lookup_idx").on(t.provider, t.service, t.effectiveFrom),
    index("provider_cost_rates_active_idx").on(t.effectiveTo),
  ],
);

export type ProviderCostRate = typeof providerCostRatesTable.$inferSelect;
export type InsertProviderCostRate = typeof providerCostRatesTable.$inferInsert;

/**
 * Effective-dated customer (list) pricing rates (Admin V2).
 */
export const customerPricingRatesTable = pgTable(
  "customer_pricing_rates",
  {
    id: serial("id").primaryKey(),
    plan: text("plan").notNull().default("standard"),
    segment: text("segment").notNull().default("default"),
    service: text("service").notNull(), // voice | phone | other
    billingUnit: text("billing_unit").notNull(),
    rate: numeric("rate", { precision: 18, scale: 6 }).notNull(),
    currency: text("currency").notNull().default("INR"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdBy: text("created_by"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("customer_pricing_rates_lookup_idx").on(t.plan, t.segment, t.service, t.effectiveFrom),
    index("customer_pricing_rates_active_idx").on(t.effectiveTo),
  ],
);

export type CustomerPricingRate = typeof customerPricingRatesTable.$inferSelect;
export type InsertCustomerPricingRate = typeof customerPricingRatesTable.$inferInsert;

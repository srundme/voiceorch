import { pgTable, text, serial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Admin-controlled per-minute reseller rates for each provider category.
 * These are the rates charged to users (in USD cents) — NOT the underlying
 * carrier/API cost. Admin sets these; the system bills users accordingly.
 *
 * category: "llm" | "asr" | "tts" | "telephony"
 * provider_name: e.g. "openai", "deepgram", "elevenlabs", "vobiz"
 * rate_cents_per_min: integer cents — e.g. 1 = $0.01/min
 */
export const providerMinuteRatesTable = pgTable(
  "provider_minute_rates",
  {
    id:               serial("id").primaryKey(),
    category:         text("category").notNull(),      // "llm" | "asr" | "tts" | "telephony"
    providerName:     text("provider_name").notNull(),
    rateCentsPerMin:  integer("rate_cents_per_min").notNull().default(0),
    label:            text("label"),                   // Display name (optional)
    updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("provider_minute_rates_uniq_idx").on(t.category, t.providerName),
  ],
);

export type ProviderMinuteRate    = typeof providerMinuteRatesTable.$inferSelect;
export type InsertProviderMinuteRate = typeof providerMinuteRatesTable.$inferInsert;

import { pgTable, text, serial, timestamp, bigint, uniqueIndex } from "drizzle-orm/pg-core";

// Prices are stored as micros of USD (1 USD = 1_000_000 micros).
// Token prices are per 1,000,000 tokens. Audio is per second. Characters is per character.
export const providerPricingTable = pgTable(
  "provider_pricing",
  {
    id: serial("id").primaryKey(),
    service: text("service").notNull(), // "stt" | "tts" | "llm"
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokenPricePerMillionMicros: bigint("input_token_price_per_million_micros", { mode: "number" }).notNull().default(0),
    outputTokenPricePerMillionMicros: bigint("output_token_price_per_million_micros", { mode: "number" }).notNull().default(0),
    audioSecondPriceMicros: bigint("audio_second_price_micros", { mode: "number" }).notNull().default(0),
    characterPriceMicros: bigint("character_price_micros", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("provider_pricing_uniq_idx").on(t.service, t.provider, t.model),
  }),
);

export type ProviderPricing = typeof providerPricingTable.$inferSelect;
export type InsertProviderPricing = typeof providerPricingTable.$inferInsert;

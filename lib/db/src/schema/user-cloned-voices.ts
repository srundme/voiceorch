import { pgTable, serial, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Per-user cloned / custom voices.
 * - cartesia: instant clone via platform managed Cartesia key (cartesiaVoiceId = UUID)
 * - sarvam: Creative Studio clone speaker id registered here (cartesiaVoiceId = speaker)
 * The voice id column stays named cartesia_voice_id for migration continuity;
 * agents.tts_voice stores the same id string for both providers.
 */
export const userClonedVoicesTable = pgTable(
  "user_cloned_voices",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** Provider voice id (Cartesia UUID or Sarvam speaker / clone id). */
    cartesiaVoiceId: text("cartesia_voice_id").notNull(),
    /** "cartesia" | "sarvam" */
    provider: text("provider").notNull().default("cartesia"),
    name: text("name").notNull(),
    /** Base language code, e.g. hi, en, ta — not regional BCP-47. */
    language: text("language").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("user_cloned_voices_user_id_idx").on(t.userId),
    uniqueIndex("user_cloned_voices_provider_voice_uidx").on(t.provider, t.cartesiaVoiceId),
  ],
);

export type UserClonedVoice = typeof userClonedVoicesTable.$inferSelect;
export type InsertUserClonedVoice = typeof userClonedVoicesTable.$inferInsert;

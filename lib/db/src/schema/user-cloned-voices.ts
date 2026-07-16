import { pgTable, serial, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Per-user Cartesia instant voice clones created via the platform managed key.
 * The Cartesia voice UUID is stored in cartesiaVoiceId and used as agents.tts_voice.
 */
export const userClonedVoicesTable = pgTable(
  "user_cloned_voices",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    cartesiaVoiceId: text("cartesia_voice_id").notNull(),
    name: text("name").notNull(),
    /** Cartesia language code (base), e.g. hi, en, ta — not regional BCP-47. */
    language: text("language").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("user_cloned_voices_user_id_idx").on(t.userId),
    uniqueIndex("user_cloned_voices_cartesia_voice_id_uidx").on(t.cartesiaVoiceId),
  ],
);

export type UserClonedVoice = typeof userClonedVoicesTable.$inferSelect;
export type InsertUserClonedVoice = typeof userClonedVoicesTable.$inferInsert;

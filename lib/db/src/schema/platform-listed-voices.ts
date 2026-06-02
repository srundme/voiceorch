import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const platformListedVoicesTable = pgTable("platform_listed_voices", {
  id: serial("id").primaryKey(),
  voiceId: text("voice_id").notNull().unique(),
  voiceName: text("voice_name").notNull(),
  language: text("language").notNull().default("en"),
  gender: text("gender"),
  description: text("description").notNull().default(""),
  isListed: boolean("is_listed").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

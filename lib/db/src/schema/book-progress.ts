import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * Per-device progress for "The SnapServe Book" (artifacts/snapserve-book).
 *
 * The book has no login — each browser generates an anonymous UUID once and
 * stores it in localStorage. That UUID is the primary key here, so there is
 * exactly one row per device. Mutations are atomic at the SQL level
 * (append-if-missing / array_remove / jsonb merge) to avoid lost updates.
 */
export const bookProgressTable = pgTable("book_progress", {
  deviceId: text("device_id").primaryKey(),
  completedChapters: text("completed_chapters").array().notNull().default([]),
  quizAnswers: jsonb("quiz_answers").$type<Record<string, number>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BookProgress = typeof bookProgressTable.$inferSelect;

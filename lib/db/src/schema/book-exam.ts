import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";

/**
 * Attempts at "The SnapServe Book" final exam.
 *
 * The book has no login — each browser generates an anonymous UUID once (the
 * same device id used by book_progress). Every submission writes one immutable
 * row here, so a device can have many attempts and we can show best score /
 * pass status. Grading happens server-side (the answer key never reaches the
 * client), so `score`/`passed` are authoritative.
 */
export const bookExamAttemptsTable = pgTable(
  "book_exam_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: text("device_id").notNull(),
    score: integer("score").notNull(),
    total: integer("total").notNull(),
    passed: boolean("passed").notNull(),
    durationSeconds: integer("duration_seconds"),
    // Map of question id -> chosen answer (index for single, index[] for multi).
    answers: jsonb("answers")
      .$type<Record<string, number | number[]>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    deviceIdx: index("book_exam_attempts_device_idx").on(t.deviceId),
  }),
);

export type BookExamAttempt = typeof bookExamAttemptsTable.$inferSelect;

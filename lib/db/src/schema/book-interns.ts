import {
  pgTable,
  text,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";

/**
 * Registered interns for "The SnapServe Book".
 *
 * When a new visitor signs up via InternGate (name + email), the book POSTs
 * their info here along with their anonymous deviceId so we can cross-reference
 * with book_progress and book_exam_attempts. Upserted on email — re-registering
 * from a new device just updates the deviceId.
 */
export const bookInternsTable = pgTable(
  "book_interns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    deviceId: text("device_id"),
    registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    emailIdx: index("book_interns_email_idx").on(t.email),
    deviceIdx: index("book_interns_device_idx").on(t.deviceId),
  }),
);

export type BookIntern = typeof bookInternsTable.$inferSelect;

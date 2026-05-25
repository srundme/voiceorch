import { pgTable, text, date, primaryKey } from "drizzle-orm/pg-core";

export const usageSpikeNotificationsTable = pgTable(
  "usage_spike_notifications",
  {
    clerkId: text("clerk_id").notNull(),
    notifiedDate: date("notified_date").notNull(),
  },
  (t) => [primaryKey({ columns: [t.clerkId, t.notifiedDate] })],
);

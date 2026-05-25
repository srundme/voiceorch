import { pgTable, text, date, primaryKey } from "drizzle-orm/pg-core";

export const usageSpikeDismissalsTable = pgTable(
  "usage_spike_dismissals",
  {
    clerkId: text("clerk_id").notNull(),
    dismissedDate: date("dismissed_date").notNull(),
  },
  (t) => [primaryKey({ columns: [t.clerkId, t.dismissedDate] })],
);

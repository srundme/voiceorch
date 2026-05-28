import { pgTable, serial, text, timestamp, integer, index } from "drizzle-orm/pg-core";

export const alertNotificationLogTable = pgTable(
  "alert_notification_log",
  {
    id: serial("id").primaryKey(),
    alertId: integer("alert_id"),
    channel: text("channel").notNull(), // email | slack
    status: text("status").notNull(), // sent | failed
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index("alert_notification_log_created_idx").on(t.createdAt),
    channelIdx: index("alert_notification_log_channel_idx").on(t.channel),
    statusIdx: index("alert_notification_log_status_idx").on(t.status),
  }),
);

export type AlertNotificationLog = typeof alertNotificationLogTable.$inferSelect;
export type InsertAlertNotificationLog = typeof alertNotificationLogTable.$inferInsert;

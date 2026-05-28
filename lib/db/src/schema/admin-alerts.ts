import { pgTable, text, serial, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

// Persistent admin alerts for the Usage Monitoring dashboard.
// dedupeKey ensures the same condition does not spam — alerts with the same
// dedupe key inside the active window are skipped.
export const adminAlertsTable = pgTable(
  "admin_alerts",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    type: text("type").notNull(), // low_balance | threshold_80 | threshold_90 | threshold_100 | error_spike | usage_spike | provider_down
    severity: text("severity").notNull(), // info | warning | critical
    title: text("title").notNull(),
    message: text("message").notNull(),
    service: text("service"),
    provider: text("provider"),
    model: text("model"),
    payload: jsonb("payload"),
    dedupeKey: text("dedupe_key").notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: text("acknowledged_by"),
  },
  (t) => ({
    dedupeUniq: uniqueIndex("admin_alerts_dedupe_uniq_idx").on(t.dedupeKey),
    createdIdx: index("admin_alerts_created_idx").on(t.createdAt),
    ackIdx: index("admin_alerts_ack_idx").on(t.acknowledgedAt),
  }),
);

export type AdminAlert = typeof adminAlertsTable.$inferSelect;
export type InsertAdminAlert = typeof adminAlertsTable.$inferInsert;

import { pgTable, text, serial, timestamp, jsonb } from "drizzle-orm/pg-core";

export const adminAuditLogsTable = pgTable("admin_audit_logs", {
  id: serial("id").primaryKey(),
  adminId: text("admin_id").notNull(),
  targetUserId: text("target_user_id"),
  targetResourceType: text("target_resource_type"),
  targetResourceId: text("target_resource_id"),
  action: text("action").notNull(),
  beforeValue: jsonb("before_value"),
  afterValue: jsonb("after_value"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AdminAuditLog = typeof adminAuditLogsTable.$inferSelect;

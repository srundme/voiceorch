import { pgTable, text, serial, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";

/** Health check log for managed provider credentials (Admin V2 Phase 4). */
export const managedKeyHealthChecksTable = pgTable(
  "managed_key_health_checks",
  {
    id: serial("id").primaryKey(),
    credentialKey: text("credential_key").notNull(), // platform_settings key, e.g. managed_groq_key
    status: text("status").notNull(), // healthy | warning | failed | skipped
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    errorMessageSafe: text("error_message_safe"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("managed_key_health_cred_idx").on(t.credentialKey),
    index("managed_key_health_checked_idx").on(t.checkedAt),
  ],
);

export type ManagedKeyHealthCheck = typeof managedKeyHealthChecksTable.$inferSelect;

/** Audit trail for managed key create/update/rotate/test/disable. */
export const managedKeyAuditTable = pgTable(
  "managed_key_audit",
  {
    id: serial("id").primaryKey(),
    credentialKey: text("credential_key").notNull(),
    action: text("action").notNull(), // test | rotate | update | disable
    adminId: text("admin_id").notNull().default("admin"),
    previousStatus: text("previous_status"),
    newStatus: text("new_status"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("managed_key_audit_cred_idx").on(t.credentialKey),
    index("managed_key_audit_created_idx").on(t.createdAt),
  ],
);

export type ManagedKeyAudit = typeof managedKeyAuditTable.$inferSelect;

import { pgTable, serial, text, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { agentsTable } from "./agents";
import { phoneNumbersTable } from "./phone-numbers";
import { callsTable } from "./calls";

export const metaIntegrationsTable = pgTable(
  "meta_integrations",
  {
    id:                   serial("id").primaryKey(),
    userId:               text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
    pageName:             text("page_name"),
    formId:               text("form_id").notNull(),
    formName:             text("form_name"),
    agentId:              integer("agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
    phoneNumberId:        integer("phone_number_id").references(() => phoneNumbersTable.id, { onDelete: "set null" }),
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    webhookToken:         text("webhook_token").notNull().unique(),
    active:               boolean("active").notNull().default(true),
    createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("meta_integrations_user_idx").on(t.userId)],
);

export const metaLeadsTable = pgTable(
  "meta_leads",
  {
    id:            serial("id").primaryKey(),
    integrationId: integer("integration_id").notNull().references(() => metaIntegrationsTable.id, { onDelete: "cascade" }),
    userId:        text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
    leadgenId:     text("leadgen_id").notNull().unique(),
    leadData:      jsonb("lead_data").notNull().default({}),
    phone:         text("phone"),
    name:          text("name"),
    email:         text("email"),
    callStatus:    text("call_status").notNull().default("pending"),
    callAttempts:  integer("call_attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    callId:        integer("call_id").references(() => callsTable.id, { onDelete: "set null" }),
    createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("meta_leads_integration_idx").on(t.integrationId),
    index("meta_leads_user_idx").on(t.userId, t.createdAt),
  ],
);

export type MetaIntegration = typeof metaIntegrationsTable.$inferSelect;
export type MetaLead        = typeof metaLeadsTable.$inferSelect;

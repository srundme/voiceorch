import { pgTable, serial, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const deploymentEventsTable = pgTable("deployment_events", {
  id:            serial("id").primaryKey(),
  railwayDeployId: text("railway_deploy_id"),
  projectId:     text("project_id"),
  serviceId:     text("service_id"),
  serviceName:   text("service_name"),
  environment:   text("environment"),
  status:        text("status").notNull(),
  deployUrl:     text("deploy_url"),
  commitMessage: text("commit_message"),
  commitHash:    text("commit_hash"),
  triggeredBy:   text("triggered_by"),
  payload:       jsonb("payload").$type<Record<string, unknown>>().default({}),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("deployment_events_status_idx").on(table.status),
  index("deployment_events_created_at_idx").on(table.createdAt),
  index("deployment_events_service_idx").on(table.serviceName),
]);

export type DeploymentEvent = typeof deploymentEventsTable.$inferSelect;

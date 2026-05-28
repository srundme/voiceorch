import { pgTable, text, serial, timestamp, integer, bigint, boolean, jsonb, index } from "drizzle-orm/pg-core";

export const usageEventsTable = pgTable(
  "usage_events",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    callId: integer("call_id"),
    userId: text("user_id"),
    workspaceId: text("workspace_id"),
    service: text("service").notNull(), // "stt" | "tts" | "llm"
    provider: text("provider").notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    audioSeconds: integer("audio_seconds").notNull().default(0),
    characters: integer("characters").notNull().default(0),
    latencyMs: integer("latency_ms"),
    estimatedCostMicros: bigint("estimated_cost_micros", { mode: "number" }).notNull().default(0),
    success: boolean("success").notNull().default(true),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata"),
  },
  (t) => ({
    createdIdx: index("usage_events_created_idx").on(t.createdAt),
    serviceIdx: index("usage_events_service_idx").on(t.service, t.provider, t.model),
    userIdx: index("usage_events_user_idx").on(t.userId),
    workspaceIdx: index("usage_events_workspace_idx").on(t.workspaceId),
    callIdx: index("usage_events_call_idx").on(t.callId),
    successIdx: index("usage_events_success_idx").on(t.success),
  }),
);

export type UsageEvent = typeof usageEventsTable.$inferSelect;
export type InsertUsageEvent = typeof usageEventsTable.$inferInsert;

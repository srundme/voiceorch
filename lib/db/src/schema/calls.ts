import { pgTable, text, serial, timestamp, integer, json, index, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { agentsTable } from "./agents";

/** Raw binary column (PostgreSQL `bytea`) stored/returned as a Node Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const callsTable = pgTable("calls", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  agentId: integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  toNumber: text("to_number").notNull(),
  fromNumber: text("from_number").notNull(),
  durationSeconds: integer("duration_seconds"),
  transcript: text("transcript"),
  recordingUrl: text("recording_url"),
  recordingError: text("recording_error"),
  callSummary: text("call_summary"),
  errorMessage: text("error_message"),
  executionId: text("execution_id"),
  metadata: text("metadata"),
  sttLatencyMs: integer("stt_latency_ms"),
  llmLatencyMs: integer("llm_latency_ms"),
  ttsFirstChunkMs: integer("tts_first_chunk_ms"),
  costCents: integer("cost_cents"),
  dispositionResult: json("disposition_result").$type<Record<string, string | number | boolean>>(),
  // P2-A: Call Transfer
  transferType: text("transfer_type"),   // "warm" | "cold"
  transferTarget: text("transfer_target"), // E.164 or SIP URI transferred to
  // P2-B: AMD / Voicemail Detection
  amdResult: text("amd_result"),         // "human" | "machine" | "unknown"
  // Post-call analysis
  successEvaluation: text("success_evaluation"), // "PASS / FAIL + reason" from LLM pass
  // Token optimization tracking
  tokensSaved: integer("tokens_saved"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const insertCallSchema = createInsertSchema(callsTable).omit({ id: true, createdAt: true });
export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = typeof callsTable.$inferSelect;

// ── Call Recordings — encoded WAV blobs stored directly in Postgres ────────
// Kept in a separate table (not a column on `calls`) so the binary audio is
// never loaded by normal call list/detail queries.
export const callRecordingsTable = pgTable("call_recordings", {
  id: serial("id").primaryKey(),
  callId: integer("call_id").notNull().references(() => callsTable.id, { onDelete: "cascade" }),
  audio: bytea("audio").notNull(),
  contentType: text("content_type").notNull().default("audio/wav"),
  byteSize: integer("byte_size").notNull(),
  sampleRate: integer("sample_rate").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("call_recordings_call_id_idx").on(t.callId)]);

export type CallRecording = typeof callRecordingsTable.$inferSelect;

export const callEventsTable = pgTable("call_events", {
  id: serial("id").primaryKey(),
  callId: integer("call_id").notNull().references(() => callsTable.id, { onDelete: "cascade" }),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  level: text("level").notNull().default("info"),
  event: text("event").notNull(),
  data: json("data").$type<Record<string, unknown>>(),
}, (t) => [index("call_events_call_id_idx").on(t.callId)]);

export type CallEvent = typeof callEventsTable.$inferSelect;

// ── Execution Logs — rich per-call debugging timeline ─────────────────────
export const executionLogsTable = pgTable("execution_logs", {
  id: serial("id").primaryKey(),
  callId: integer("call_id").notNull().references(() => callsTable.id, { onDelete: "cascade" }),
  agentId: integer("agent_id"),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  component: text("component").notNull(),   // Agent | STT | LLM | TTS | Tool | Memory | Knowledge | VariableResolver | Webhook
  provider: text("provider"),               // Deepgram | OpenAI | ElevenLabs | …
  direction: text("direction").notNull(),   // request | response | system
  status: text("status").notNull().default("info"), // success | error | info
  latencyMs: integer("latency_ms"),
  requestPayload: json("request_payload").$type<Record<string, unknown>>(),
  responsePayload: json("response_payload").$type<Record<string, unknown>>(),
  metadata: json("metadata").$type<Record<string, unknown>>(),
}, (t) => [
  index("execution_logs_call_id_idx").on(t.callId),
  index("execution_logs_ts_idx").on(t.ts),
]);

export type ExecutionLog = typeof executionLogsTable.$inferSelect;

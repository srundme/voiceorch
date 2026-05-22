import { pgTable, text, serial, timestamp, integer, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { agentsTable } from "./agents";

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const insertCallSchema = createInsertSchema(callsTable).omit({ id: true, createdAt: true });
export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = typeof callsTable.$inferSelect;

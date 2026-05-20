import { pgTable, text, serial, timestamp, integer, real, boolean, json } from "drizzle-orm/pg-core";
import { knowledgeBasesTable } from "./knowledge-base";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const agentsTable = pgTable("agents", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("draft"),
  asrProvider: text("asr_provider").notNull(),
  asrModel: text("asr_model"),
  asrLanguage: text("asr_language"),
  asrBackgroundDenoising: boolean("asr_background_denoising").default(false),
  asrConfidenceThreshold: real("asr_confidence_threshold"),
  asrEndOfTurnConfidence: real("asr_end_of_turn_confidence"),
  asrEndOfTurnTimeout: integer("asr_end_of_turn_timeout"),
  asrKeyterms: text("asr_keyterms"),
  asrSmartEndpointing: text("asr_smart_endpointing").default("off"),
  asrAutoFallback: boolean("asr_auto_fallback").default(false),
  llmProvider: text("llm_provider").notNull(),
  llmModel: text("llm_model"),
  ttsProvider: text("tts_provider").notNull(),
  ttsVoice: text("tts_voice"),
  ttsModel: text("tts_model"),
  telephonyProvider: text("telephony_provider").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  temperature: real("temperature"),
  maxDuration: integer("max_duration"),

  // ── Conversation Behavior (Tier 1) ───────────────────────────────────────────
  greetingMessage: text("greeting_message"),
  endCallPhrases: text("end_call_phrases"),
  silenceTimeoutSeconds: integer("silence_timeout_seconds"),
  language: text("language"),
  backchannelingEnabled: boolean("backchanneling_enabled").default(false),
  backchannelingFrequency: real("backchanneling_frequency"),
  webhookUrl: text("webhook_url"),
  noiseCancellationEnabled: boolean("noise_cancellation_enabled").default(false),
  inactivityMessage: text("inactivity_message"),

  // ── Knowledge Base ────────────────────────────────────────────────────────────
  knowledgeBaseId: integer("knowledge_base_id").references(() => knowledgeBasesTable.id, { onDelete: "set null" }),

  // ── Tools ─────────────────────────────────────────────────────────────────────
  tools: json("tools").$type<Record<string, unknown>[]>(),

  // ── Disposition Schema ────────────────────────────────────────────────────────
  dispositionSchema: json("disposition_schema").$type<Array<{
    key: string;
    label: string;
    type: "text" | "number" | "choice" | "boolean";
    options?: string[];
    required?: boolean;
  }>>(),

  // ── Usage Limits ─────────────────────────────────────────────────────────────
  maxConcurrentCalls: integer("max_concurrent_calls"),
  monthlySpendLimitCents: integer("monthly_spend_limit_cents"),

  // ── Stats ────────────────────────────────────────────────────────────────────
  totalCalls: integer("total_calls").notNull().default(0),
  successfulCalls: integer("successful_calls").notNull().default(0),
  avgDurationSeconds: integer("avg_duration_seconds"),
  avgSttLatencyMs: integer("avg_stt_latency_ms"),
  avgLlmLatencyMs: integer("avg_llm_latency_ms"),
  avgTtsFirstChunkMs: integer("avg_tts_first_chunk_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAgentSchema = createInsertSchema(agentsTable).omit({ id: true, createdAt: true, updatedAt: true, totalCalls: true, successfulCalls: true });
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agentsTable.$inferSelect;

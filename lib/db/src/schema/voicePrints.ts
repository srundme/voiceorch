import { pgTable, serial, integer, text, real, timestamp } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents.js";

/**
 * Stores Azure Speaker Recognition profile IDs per caller per agent.
 * Used for cross-call voice identity — recognising a caller even from
 * a different phone number — and for mid-call speaker change detection.
 */
export const voicePrintsTable = pgTable("voice_prints", {
  id:                      serial("id").primaryKey(),
  agentId:                 integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  phoneNumber:             text("phone_number").notNull(),
  azureProfileId:          text("azure_profile_id").notNull(),
  enrollmentStatus:        text("enrollment_status").notNull().default("pending"),
  enrollmentSpeechSeconds: real("enrollment_speech_seconds").notNull().default(0),
  lastIdentifiedAt:        timestamp("last_identified_at"),
  lastConfidenceScore:     real("last_confidence_score"),
  createdAt:               timestamp("created_at").defaultNow().notNull(),
  updatedAt:               timestamp("updated_at").defaultNow().notNull(),
});

export type VoicePrint = typeof voicePrintsTable.$inferSelect;
export type NewVoicePrint = typeof voicePrintsTable.$inferInsert;

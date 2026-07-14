import { pgTable, serial, integer, text, timestamp, uniqueIndex, index, real, jsonb } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

/**
 * ECAPA voice fingerprints for Voice Memory (opt-in per agent).
 * Links phones that share a voice to the same personKey so memory can follow
 * the speaker across numbers. Does not replace phone-keyed caller_profiles.
 */
export const callerVoiceprintsTable = pgTable("caller_voiceprints", {
  id:          serial("id").primaryKey(),
  agentId:     integer("agent_id").references(() => agentsTable.id, { onDelete: "cascade" }).notNull(),
  /** Stable person identity shared across phones when voice matches. */
  personKey:   text("person_key").notNull(),
  /** Canonical caller key (same as caller_profiles.phone_number). */
  phoneNumber: text("phone_number").notNull(),
  /** L2-normalised 192-dim ECAPA embedding. */
  embedding:   jsonb("embedding").$type<number[]>().notNull(),
  /** Optional display name latched for this person. */
  displayName: text("display_name"),
  matchCount:  integer("match_count").default(1).notNull(),
  lastScore:   real("last_score"),
  lastSeenAt:  timestamp("last_seen_at").defaultNow().notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("caller_voiceprints_agent_phone_uidx").on(t.agentId, t.phoneNumber),
  index("caller_voiceprints_agent_person_idx").on(t.agentId, t.personKey),
]);

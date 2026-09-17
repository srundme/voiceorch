import { pgTable, serial, integer, text, date, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";
import { callsTable } from "./calls";

/**
 * Candidate intake form filled DURING an inbound call.
 *
 * The agent asks each question and writes the answer field-by-field, so the
 * browser form is a live view of one row: every write bumps `revision` and the
 * SSE stream replays the row. Nothing here is submitted by the candidate.
 *
 * English communication is scored by the reviewer AFTER the call ends, so it
 * stays null while `status` is `in_progress`.
 */

export type IntakeStatus = "in_progress" | "completed";
export type IntakeGender = "MALE" | "FEMALE" | "OTHER";
export type IntakeWorkStatus = "FRESHER" | "EXPERIENCED";
export type IntakeEnglishCommunication =
  | "EXCELLENT"
  | "VERY_GOOD"
  | "GOOD"
  | "AVERAGE"
  | "POOR";
export type IntakeQualification = "GRADUATE" | "POST_GRADUATE";
export type IntakeShiftBase =
  | "ANY"
  | "DAY_ONLY"
  | "NIGHT_ONLY"
  | "UK"
  | "US"
  | "AUS"
  | "DOMESTIC"
  | "ROTATIONAL";
/** ACTIVATE = candidate asked us not to call again. */
export type IntakeDnd = "ACTIVATE" | "DEACTIVATE";

/** Who last wrote a field — drives the "filled by agent" highlight in the UI. */
export type IntakeWriteSource = "agent" | "human";

export const candidateIntakesTable = pgTable("candidate_intakes", {
  id: serial("id").primaryKey(),
  /** Shared in the live form URL; also the write credential for the agent. */
  publicToken: text("public_token").notNull().unique(),
  userId: text("user_id"),
  agentId: integer("agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
  callId: integer("call_id").references(() => callsTable.id, { onDelete: "set null" }),
  status: text("status").$type<IntakeStatus>().notNull().default("in_progress"),

  // ── Customer details (asked on the call) ────────────────────────────────────
  firstName: text("first_name"),
  lastName: text("last_name"),
  phone: text("phone"),
  email: text("email"),
  gender: text("gender").$type<IntakeGender>(),
  dateOfBirth: date("date_of_birth", { mode: "string" }),
  workStatus: text("work_status").$type<IntakeWorkStatus>(),
  totalCompanies: integer("total_companies"),
  /** Where the candidate currently lives. */
  city: text("city"),
  /** Where the client is offering the job. */
  jobCity: text("job_city"),

  // ── Job information ─────────────────────────────────────────────────────────
  /** Fixed for this demo: Executive / Sr Executive. */
  skillRole: text("skill_role"),
  /** Fixed for this demo: International Voice Process. */
  skill: text("skill"),
  /** Fixed for this demo: BPO / Call Center. */
  industry: text("industry"),
  qualification: text("qualification").$type<IntakeQualification>(),
  shiftBase: text("shift_base").$type<IntakeShiftBase>(),
  /**
   * Marked AFTER the call when the candidate is no longer interested.
   * ACTIVATE = do not disturb.
   */
  dnd: text("dnd").$type<IntakeDnd>(),

  // ── Post-call evaluation ────────────────────────────────────────────────────
  englishCommunication: text("english_communication").$type<IntakeEnglishCommunication>(),

  /** Later form sections land here until they earn typed columns. */
  extra: jsonb("extra").$type<Record<string, unknown>>().notNull().default({}),

  /** Incremented on every write so a reconnecting form can skip stale frames. */
  revision: integer("revision").notNull().default(0),
  lastFieldKey: text("last_field_key"),
  lastWriteSource: text("last_write_source").$type<IntakeWriteSource>(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("candidate_intakes_user_id_idx").on(t.userId),
  index("candidate_intakes_agent_id_idx").on(t.agentId),
  index("candidate_intakes_call_id_idx").on(t.callId),
  index("candidate_intakes_status_idx").on(t.status),
]);

export type CandidateIntake = typeof candidateIntakesTable.$inferSelect;
export type InsertCandidateIntake = typeof candidateIntakesTable.$inferInsert;

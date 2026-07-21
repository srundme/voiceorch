import {
  pgTable, serial, integer, text, timestamp, jsonb, boolean, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";
import { agentVersionsTable } from "./agent-versions";
import { webcallLinksTable } from "./webcall-links";

/**
 * Voice-a-thon competition events — organizer-owned contests where teams
 * register publicly, build SnapServe agents, and submit them for judging.
 */

export type VoiceathonEventStatus =
  | "draft"
  | "published"
  | "registration_closed"
  | "submission_closed"
  | "judging"
  | "completed"
  | "archived";

export type VoiceathonEventMode = "online" | "offline" | "hybrid";

export type VoiceathonRubricCriterion = {
  id: string;
  label: string;
  description?: string;
  maxScore: number;
  weight: number;
};

export type VoiceathonFaqItem = {
  question: string;
  answer: string;
};

export type VoiceathonPrize = {
  place: string;
  title: string;
  description?: string;
};

export const voiceathonEventsTable = pgTable("voiceathon_events", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  tagline: text("tagline"),
  description: text("description"),
  bannerUrl: text("banner_url"),
  mode: text("mode").$type<VoiceathonEventMode>().notNull().default("online"),
  venue: text("venue"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  status: text("status").$type<VoiceathonEventStatus>().notNull().default("draft"),
  registrationOpensAt: timestamp("registration_opens_at", { withTimezone: true }),
  registrationClosesAt: timestamp("registration_closes_at", { withTimezone: true }),
  eventStartsAt: timestamp("event_starts_at", { withTimezone: true }),
  eventEndsAt: timestamp("event_ends_at", { withTimezone: true }),
  submissionOpensAt: timestamp("submission_opens_at", { withTimezone: true }),
  submissionClosesAt: timestamp("submission_closes_at", { withTimezone: true }),
  judgingOpensAt: timestamp("judging_opens_at", { withTimezone: true }),
  judgingClosesAt: timestamp("judging_closes_at", { withTimezone: true }),
  minTeamSize: integer("min_team_size").notNull().default(1),
  maxTeamSize: integer("max_team_size").notNull().default(4),
  maxTeams: integer("max_teams"),
  rules: text("rules"),
  eligibility: text("eligibility"),
  prizes: jsonb("prizes").$type<VoiceathonPrize[]>().notNull().default([]),
  faq: jsonb("faq").$type<VoiceathonFaqItem[]>().notNull().default([]),
  rubric: jsonb("rubric").$type<VoiceathonRubricCriterion[]>().notNull().default([]),
  leaderboardPublished: boolean("leaderboard_published").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("voiceathon_events_user_id_idx").on(t.userId),
  index("voiceathon_events_status_idx").on(t.status),
]);

export type VoiceathonTeamStatus =
  | "registered"
  | "claimed"
  | "submitted"
  | "disqualified"
  | "withdrawn";

export type VoiceathonTeamPlacement = "participant" | "finalist" | "winner" | "runner_up";

export const voiceathonTeamsTable = pgTable("voiceathon_teams", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => voiceathonEventsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Unguessable public reference shown after registration. */
  referenceCode: text("reference_code").notNull().unique(),
  institution: text("institution"),
  city: text("city"),
  leaderName: text("leader_name").notNull(),
  leaderEmail: text("leader_email").notNull(),
  /** Lowercased/trimmed for claim matching. */
  leaderEmailNormalized: text("leader_email_normalized").notNull(),
  leaderPhone: text("leader_phone"),
  status: text("status").$type<VoiceathonTeamStatus>().notNull().default("registered"),
  claimedByUserId: text("claimed_by_user_id"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  placement: text("placement").$type<VoiceathonTeamPlacement>().notNull().default("participant"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("voiceathon_teams_event_id_idx").on(t.eventId),
  index("voiceathon_teams_leader_email_idx").on(t.eventId, t.leaderEmailNormalized),
  index("voiceathon_teams_claimed_by_idx").on(t.claimedByUserId),
  uniqueIndex("voiceathon_teams_event_leader_uidx").on(t.eventId, t.leaderEmailNormalized),
]);

export const voiceathonTeamMembersTable = pgTable("voiceathon_team_members", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => voiceathonTeamsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email"),
  emailNormalized: text("email_normalized"),
  phone: text("phone"),
  role: text("role").notNull().default("member"), // leader | member
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("voiceathon_team_members_team_id_idx").on(t.teamId),
]);

export type VoiceathonSubmissionStatus = "draft" | "submitted" | "withdrawn";

export const voiceathonSubmissionsTable = pgTable("voiceathon_submissions", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => voiceathonEventsTable.id, { onDelete: "cascade" }),
  teamId: integer("team_id").notNull().references(() => voiceathonTeamsTable.id, { onDelete: "cascade" }),
  agentId: integer("agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
  agentVersionId: integer("agent_version_id").references(() => agentVersionsTable.id, { onDelete: "set null" }),
  webcallLinkId: integer("webcall_link_id").references(() => webcallLinksTable.id, { onDelete: "set null" }),
  projectTitle: text("project_title"),
  projectSummary: text("project_summary"),
  status: text("status").$type<VoiceathonSubmissionStatus>().notNull().default("draft"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  submittedByUserId: text("submitted_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("voiceathon_submissions_team_uidx").on(t.teamId),
  index("voiceathon_submissions_event_id_idx").on(t.eventId),
  index("voiceathon_submissions_status_idx").on(t.eventId, t.status),
]);

export type VoiceathonJudgeStatus = "invited" | "active" | "revoked";

export const voiceathonJudgesTable = pgTable("voiceathon_judges", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => voiceathonEventsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  emailNormalized: text("email_normalized").notNull(),
  /** SHA-256 hex of the opaque invite token. */
  tokenHash: text("token_hash").notNull().unique(),
  status: text("status").$type<VoiceathonJudgeStatus>().notNull().default("invited"),
  invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
  lastAccessAt: timestamp("last_access_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("voiceathon_judges_event_id_idx").on(t.eventId),
  uniqueIndex("voiceathon_judges_event_email_uidx").on(t.eventId, t.emailNormalized),
]);

export const voiceathonJudgeAssignmentsTable = pgTable("voiceathon_judge_assignments", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => voiceathonEventsTable.id, { onDelete: "cascade" }),
  judgeId: integer("judge_id").notNull().references(() => voiceathonJudgesTable.id, { onDelete: "cascade" }),
  submissionId: integer("submission_id").notNull().references(() => voiceathonSubmissionsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("voiceathon_judge_assignments_uidx").on(t.judgeId, t.submissionId),
  index("voiceathon_judge_assignments_event_idx").on(t.eventId),
]);

export type VoiceathonScoreStatus = "draft" | "final";

export type VoiceathonCriterionScore = {
  criterionId: string;
  score: number;
  note?: string;
};

export const voiceathonScoresTable = pgTable("voiceathon_scores", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => voiceathonEventsTable.id, { onDelete: "cascade" }),
  judgeId: integer("judge_id").notNull().references(() => voiceathonJudgesTable.id, { onDelete: "cascade" }),
  submissionId: integer("submission_id").notNull().references(() => voiceathonSubmissionsTable.id, { onDelete: "cascade" }),
  teamId: integer("team_id").notNull().references(() => voiceathonTeamsTable.id, { onDelete: "cascade" }),
  criteriaScores: jsonb("criteria_scores").$type<VoiceathonCriterionScore[]>().notNull().default([]),
  /** Server-computed weighted total. */
  totalScore: integer("total_score").notNull().default(0),
  privateFeedback: text("private_feedback"),
  status: text("status").$type<VoiceathonScoreStatus>().notNull().default("draft"),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("voiceathon_scores_judge_submission_uidx").on(t.judgeId, t.submissionId),
  index("voiceathon_scores_event_idx").on(t.eventId),
  index("voiceathon_scores_team_idx").on(t.teamId),
]);

export type VoiceathonAnnouncementAudience =
  | "all_teams"
  | "leaders"
  | "finalists"
  | "winners";

export type VoiceathonAnnouncementStatus = "draft" | "sending" | "sent" | "failed";

export const voiceathonAnnouncementsTable = pgTable("voiceathon_announcements", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => voiceathonEventsTable.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  bodyHtml: text("body_html").notNull(),
  audience: text("audience").$type<VoiceathonAnnouncementAudience>().notNull().default("all_teams"),
  status: text("status").$type<VoiceathonAnnouncementStatus>().notNull().default("draft"),
  recipientCount: integer("recipient_count").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  createdByUserId: text("created_by_user_id").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("voiceathon_announcements_event_idx").on(t.eventId),
]);

export type VoiceathonCertificateType = "participation" | "finalist" | "winner" | "runner_up";

export const voiceathonCertificatesTable = pgTable("voiceathon_certificates", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => voiceathonEventsTable.id, { onDelete: "cascade" }),
  teamId: integer("team_id").notNull().references(() => voiceathonTeamsTable.id, { onDelete: "cascade" }),
  memberId: integer("member_id").notNull().references(() => voiceathonTeamMembersTable.id, { onDelete: "cascade" }),
  type: text("type").$type<VoiceathonCertificateType>().notNull().default("participation"),
  /** Unguessable public verification code. */
  verificationCode: text("verification_code").notNull().unique(),
  recipientName: text("recipient_name").notNull(),
  teamName: text("team_name").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("voiceathon_certificates_event_idx").on(t.eventId),
  uniqueIndex("voiceathon_certificates_member_type_uidx").on(t.memberId, t.type),
]);

export type VoiceathonEvent = typeof voiceathonEventsTable.$inferSelect;
export type InsertVoiceathonEvent = typeof voiceathonEventsTable.$inferInsert;
export type VoiceathonTeam = typeof voiceathonTeamsTable.$inferSelect;
export type VoiceathonTeamMember = typeof voiceathonTeamMembersTable.$inferSelect;
export type VoiceathonSubmission = typeof voiceathonSubmissionsTable.$inferSelect;
export type VoiceathonJudge = typeof voiceathonJudgesTable.$inferSelect;
export type VoiceathonScore = typeof voiceathonScoresTable.$inferSelect;
export type VoiceathonAnnouncement = typeof voiceathonAnnouncementsTable.$inferSelect;
export type VoiceathonCertificate = typeof voiceathonCertificatesTable.$inferSelect;

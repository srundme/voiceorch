import { pgTable, text, serial, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Workshop feedback forms + event analytics.
 *
 * A `workshop_event` is one workshop instance (e.g. "College A - Nov") with its
 * own shareable public URL (`/workshop/:slug`). Students submit the fixed
 * 12-section feedback form anonymously; each submission is a `workshop_response`.
 * Admins create/manage events and view per-event analytics in the admin app.
 *
 * The jsonb column shapes below ARE the contract shared by the public form
 * (artifacts/dashboard) and the analytics endpoint (artifacts/api-server). Keep
 * the metric keys in sync with WORKSHOP_EVENT_EXPERIENCE_METRICS /
 * WORKSHOP_LEARNING_METRICS exported at the bottom.
 */

export interface WorkshopSession {
  /** Stable id used as the key in workshop_responses.sessionRatings. */
  id: string;
  name: string;
}

export const workshopEventsTable = pgTable("workshop_events", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  college: text("college"),
  eventDate: timestamp("event_date", { withTimezone: true }),
  /** "online" | "offline" */
  mode: text("mode").notNull().default("offline"),
  /** Section 4 rows the attendee rates individually. */
  sessions: jsonb("sessions").$type<WorkshopSession[]>().notNull().default([]),
  /** "open" (accepting responses) | "closed" */
  status: text("status").notNull().default("open"),
  /** Manual admin inputs for attendance / response-rate KPIs. */
  registrationsCount: integer("registrations_count").notNull().default(0),
  attendeesCount: integer("attendees_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export interface WorkshopAudienceProfile {
  /** Student | Working Professional | Founder | Freelancer | Faculty | Other */
  describesYou?: string;
  /** Beginner | Intermediate | Advanced */
  aiExperience?: string;
  /** Yes | No */
  builtAiBefore?: string;
  /** Yes | No */
  usedVoiceAgentsBefore?: string;
}

export interface WorkshopCareerImpact {
  /** AI Careers, AI Entrepreneurship, Product Building, Voice AI, Automation, Generative AI */
  interests?: string[];
  /** Definitely | Probably | Maybe | No */
  careerHelp?: string;
}

export interface WorkshopFutureEngagement {
  /** Internship, Placement, Live Projects, Hackathons, ... */
  interests?: string[];
  /** WhatsApp | Email | LinkedIn (multi-select) */
  stayConnected?: string[];
  /** Yes | No */
  canContact?: string;
}

export interface WorkshopOpenFeedback {
  liked?: string;
  improve?: string;
  suggestions?: string;
}

export interface WorkshopProductFeedback {
  /** 1-5 star ratings */
  tryLikelihood?: number;
  easeLooked?: number;
  wouldRecommend?: number;
  /** AI Calling | Voice Agents | Workflow Builder | Integrations | Dashboard | Analytics */
  featureInterest?: string;
}

export const workshopResponsesTable = pgTable(
  "workshop_responses",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => workshopEventsTable.id, { onDelete: "cascade" }),
    // Participant identity (typed columns for easy lead export)
    name: text("name"),
    email: text("email").notNull(),
    phone: text("phone"),
    college: text("college"),
    department: text("department"),
    yearOrExperience: text("year_or_experience"),
    city: text("city"),
    // Section payloads (see interfaces above)
    audienceProfile: jsonb("audience_profile").$type<WorkshopAudienceProfile>(),
    /** metric key -> 1-5 (keys = WORKSHOP_EVENT_EXPERIENCE_METRICS) */
    eventExperience: jsonb("event_experience").$type<Record<string, number>>(),
    /** sessionId -> 1-5 */
    sessionRatings: jsonb("session_ratings").$type<Record<string, number>>(),
    /** metric key -> 1-5 (keys = WORKSHOP_LEARNING_METRICS) */
    learningImpact: jsonb("learning_impact").$type<Record<string, number>>(),
    careerImpact: jsonb("career_impact").$type<WorkshopCareerImpact>(),
    futureEngagement: jsonb("future_engagement").$type<WorkshopFutureEngagement>(),
    futureTopics: jsonb("future_topics").$type<string[]>(),
    openFeedback: jsonb("open_feedback").$type<WorkshopOpenFeedback>(),
    /** Net Promoter Score, 0-10 */
    nps: integer("nps"),
    outcomes: jsonb("outcomes").$type<string[]>(),
    productFeedback: jsonb("product_feedback").$type<WorkshopProductFeedback>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("workshop_responses_event_id_idx").on(t.eventId)],
);

/** Section 3 — Event Experience ratings (key, label). */
export const WORKSHOP_EVENT_EXPERIENCE_METRICS: ReadonlyArray<readonly [string, string]> = [
  ["overallSatisfaction", "Overall satisfaction"],
  ["eventOrganization", "Event organization"],
  ["speakerCommunication", "Speaker communication"],
  ["speakerKnowledge", "Speaker knowledge"],
  ["sessionPace", "Session pace"],
  ["audienceInteraction", "Interaction with audience"],
  ["qaQuality", "Q&A quality"],
  ["timeManagement", "Time management"],
  ["venueExperience", "Venue / Online experience"],
  ["avQuality", "Audio & Visual quality"],
];

/** Section 5 — Learning Impact ratings (key, label). */
export const WORKSHOP_LEARNING_METRICS: ReadonlyArray<readonly [string, string]> = [
  ["learnedSomethingNew", "I learned something new"],
  ["increasedUnderstanding", "Increased understanding of AI"],
  ["understandVoiceAgents", "I now understand AI Voice Agents"],
  ["confidentToTry", "I feel confident trying it myself"],
  ["examplesPractical", "The examples were practical"],
  ["easyToFollow", "The content was easy to follow"],
];

export type WorkshopEvent = typeof workshopEventsTable.$inferSelect;
export type InsertWorkshopEvent = typeof workshopEventsTable.$inferInsert;
export type WorkshopResponse = typeof workshopResponsesTable.$inferSelect;
export type InsertWorkshopResponse = typeof workshopResponsesTable.$inferInsert;

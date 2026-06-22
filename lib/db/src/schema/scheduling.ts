import { pgTable, text, serial, timestamp, integer, boolean, unique, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { agentsTable } from "./agents";
import { callsTable } from "./calls";

export const googleCalendarConnectionsTable = pgTable("google_calendar_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  email: text("email").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull().default(""),
  tokenExpiry: timestamp("token_expiry", { withTimezone: true }),
  grantedScopes: text("granted_scopes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [unique("google_calendar_connections_user_email_unique").on(t.userId, t.email)]);

export const schedulingCalendarsTable = pgTable("scheduling_calendars", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  name: text("name").notNull().default("My Calendar"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  hostEmail: text("host_email"),
  additionalHosts: text("additional_hosts").array(),
  googleCalendarConnectionId: uuid("google_calendar_connection_id").references(() => googleCalendarConnectionsTable.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [unique("scheduling_calendars_agent_id_unique").on(t.agentId)]);

export const eventTypesTable = pgTable("event_types", {
  id: serial("id").primaryKey(),
  calendarId: integer("calendar_id").notNull().references(() => schedulingCalendarsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  durationMinutes: integer("duration_minutes").notNull().default(30),
  bufferBeforeMins: integer("buffer_before_mins").notNull().default(0),
  bufferAfterMins: integer("buffer_after_mins").notNull().default(0),
  confirmationMode: text("confirmation_mode").notNull().default("instant"),
  maxBookingsPerSlot: integer("max_bookings_per_slot").notNull().default(1),
  enableGoogleMeet: boolean("enable_google_meet").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const availabilitySchedulesTable = pgTable("availability_schedules", {
  id: serial("id").primaryKey(),
  calendarId: integer("calendar_id").notNull().references(() => schedulingCalendarsTable.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

export const availabilityOverridesTable = pgTable("availability_overrides", {
  id: serial("id").primaryKey(),
  calendarId: integer("calendar_id").notNull().references(() => schedulingCalendarsTable.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  isBlocked: boolean("is_blocked").notNull().default(false),
  startTime: text("start_time"),
  endTime: text("end_time"),
  reason: text("reason"),
});

export const bookingsTable = pgTable("bookings", {
  id: serial("id").primaryKey(),
  eventTypeId: integer("event_type_id").notNull().references(() => eventTypesTable.id, { onDelete: "restrict" }),
  calendarId: integer("calendar_id").notNull().references(() => schedulingCalendarsTable.id, { onDelete: "restrict" }),
  callId: integer("call_id").references(() => callsTable.id, { onDelete: "set null" }),
  userId: text("user_id").notNull(),
  attendeeName: text("attendee_name").notNull(),
  attendeeEmail: text("attendee_email").notNull(),
  attendeeNotes: text("attendee_notes"),
  slotStart: timestamp("slot_start", { withTimezone: true }).notNull(),
  slotEnd: timestamp("slot_end", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("pending"),
  bookedVia: text("booked_via").notNull().default("web"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  rescheduledFromId: integer("rescheduled_from_id"),
  googleEventId: text("google_event_id"),
  meetLink: text("meet_link"),
  calendarSyncStatus: text("calendar_sync_status"),
  calendarSyncError: text("calendar_sync_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSchedulingCalendarSchema = createInsertSchema(schedulingCalendarsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertEventTypeSchema = createInsertSchema(eventTypesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAvailabilityScheduleSchema = createInsertSchema(availabilitySchedulesTable).omit({ id: true });
export const insertAvailabilityOverrideSchema = createInsertSchema(availabilityOverridesTable).omit({ id: true });
export const insertBookingSchema = createInsertSchema(bookingsTable).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertSchedulingCalendar = z.infer<typeof insertSchedulingCalendarSchema>;
export type SchedulingCalendar = typeof schedulingCalendarsTable.$inferSelect;
export type InsertEventType = z.infer<typeof insertEventTypeSchema>;
export type EventType = typeof eventTypesTable.$inferSelect;
export type InsertAvailabilitySchedule = z.infer<typeof insertAvailabilityScheduleSchema>;
export type AvailabilitySchedule = typeof availabilitySchedulesTable.$inferSelect;
export type InsertAvailabilityOverride = z.infer<typeof insertAvailabilityOverrideSchema>;
export type AvailabilityOverride = typeof availabilityOverridesTable.$inferSelect;
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookingsTable.$inferSelect;

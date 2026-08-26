/**
 * Shared API helpers for the Connections booking wizard (and reusable by Vibe).
 * Backend still uses calendars + Google + event types; UI calls them "meetings".
 */

import { customFetch } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export const SCHEDULING_API = `${BASE}/api`;

export const CALENDAR_TIMEZONES = [
  "UTC",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
] as const;

export type SchedulingCalendarInfo = {
  id: number;
  name: string;
  description: string | null;
  hostEmail: string | null;
  additionalHosts: string[] | null;
  connectedGoogleEmail: string | null;
  timezone: string;
};

export type GoogleConnection = { id: string; email: string };

export type MeetingInfo = {
  id: number;
  calendarId: number;
  name: string;
  slug: string;
  durationMinutes: number;
};

export type BookingSetupReadiness = {
  calendar: SchedulingCalendarInfo | null;
  googleLinked: boolean;
  meeting: MeetingInfo | null;
  requiredReadyCount: number;
  ready: boolean;
};

export const MEETING_DURATION_OPTIONS = [
  { label: "15 minutes", value: 15 },
  { label: "30 minutes", value: 30 },
  { label: "45 minutes", value: 45 },
  { label: "60 minutes (1 hour)", value: 60 },
] as const;

export function slugifyMeetingName(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "meeting";
}

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type WeeklyAvailabilitySlot = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
};

export function defaultWeeklyAvailability(): WeeklyAvailabilitySlot[] {
  return [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    dayOfWeek: d,
    startTime: "09:00",
    endTime: "17:00",
    isActive: d >= 1 && d <= 5,
  }));
}

function toHhMm(value: string): string {
  return value.slice(0, 5) || "09:00";
}

export function mergeWeeklyAvailability(
  existing: Array<{ dayOfWeek: number; startTime: string; endTime: string; isActive?: boolean }>,
): WeeklyAvailabilitySlot[] {
  return defaultWeeklyAvailability().map((def) => {
    const fetched = existing.find((s) => s.dayOfWeek === def.dayOfWeek);
    if (!fetched) return { ...def, isActive: false };
    return {
      dayOfWeek: def.dayOfWeek,
      startTime: toHhMm(fetched.startTime),
      endTime: toHhMm(fetched.endTime),
      isActive: fetched.isActive !== false,
    };
  });
}

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Agent JSON / Select values sometimes store calendar ids as strings. */
export function normalizeSchedulingId(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

export function findBySchedulingId<T extends { id: number | string }>(
  rows: T[] | undefined | null,
  id: unknown,
): T | undefined {
  const n = normalizeSchedulingId(id);
  if (n == null) return undefined;
  return (rows ?? []).find((row) => normalizeSchedulingId(row.id) === n);
}

export function computeBookingSetupReadiness(
  calendars: SchedulingCalendarInfo[],
  meetings: MeetingInfo[],
  selectedCalendarId?: number | null,
): BookingSetupReadiness {
  const calendar =
    selectedCalendarId === null
      ? null
      : selectedCalendarId != null
        ? findBySchedulingId(calendars, selectedCalendarId) ?? null
        : calendars[0] ?? null;
  const googleLinked = Boolean(calendar?.connectedGoogleEmail);
  const meeting = calendar
    ? meetings.find((m) => m.calendarId === calendar.id) ?? null
    : null;
  const requiredReadyCount = [Boolean(calendar), googleLinked, Boolean(meeting)].filter(Boolean).length;
  return {
    calendar,
    googleLinked,
    meeting,
    requiredReadyCount,
    ready: requiredReadyCount === 3,
  };
}

function mapCalendar(c: {
  id: number;
  name: string;
  description?: string | null;
  hostEmail?: string | null;
  additionalHosts?: string[] | null;
  connectedGoogleEmail?: string | null;
  timezone?: string;
}): SchedulingCalendarInfo {
  return {
    id: c.id,
    name: c.name,
    description: c.description ?? null,
    hostEmail: c.hostEmail ?? null,
    additionalHosts: c.additionalHosts ?? null,
    connectedGoogleEmail: c.connectedGoogleEmail ?? null,
    timezone: c.timezone || "UTC",
  };
}

function mapMeeting(e: {
  id: number;
  calendarId: number;
  name?: string;
  title?: string;
  slug: string;
  durationMinutes: number;
}): MeetingInfo {
  return {
    id: e.id,
    calendarId: e.calendarId,
    name: e.name || e.title || "Meeting",
    slug: e.slug,
    durationMinutes: e.durationMinutes,
  };
}

export async function listSchedulingCalendars(): Promise<SchedulingCalendarInfo[]> {
  const rows = await customFetch<Array<{
    id: number;
    name: string;
    description?: string | null;
    hostEmail?: string | null;
    additionalHosts?: string[] | null;
    connectedGoogleEmail?: string | null;
    timezone?: string;
  }>>(`${SCHEDULING_API}/scheduling/calendars`);
  return Array.isArray(rows) ? rows.map(mapCalendar) : [];
}

export async function listGoogleConnections(): Promise<GoogleConnection[]> {
  const rows = await customFetch<GoogleConnection[]>(`${SCHEDULING_API}/scheduling/google/connections`);
  return Array.isArray(rows) ? rows : [];
}

export async function listMeetings(calendarId?: number): Promise<MeetingInfo[]> {
  const qs = calendarId != null ? `?calendarId=${calendarId}` : "";
  const rows = await customFetch<Array<{
    id: number;
    calendarId: number;
    name?: string;
    title?: string;
    slug: string;
    durationMinutes: number;
  }>>(`${SCHEDULING_API}/scheduling/event-types${qs}`);
  return Array.isArray(rows) ? rows.map(mapMeeting) : [];
}

export async function createOrUpdateCalendar(input: {
  id?: number;
  name: string;
  hostEmail: string;
  description?: string | null;
  timezone?: string;
  additionalHosts?: string[];
}): Promise<SchedulingCalendarInfo> {
  const body = {
    name: input.name.trim(),
    hostEmail: input.hostEmail.trim(),
    description: input.description?.trim() || null,
    timezone: input.timezone || getBrowserTimezone(),
    additionalHosts: (input.additionalHosts ?? []).map((e) => e.trim()).filter((e) => e.includes("@")),
    isActive: true,
  };
  if (input.id != null) {
    const r = await customFetch<{
      id: number;
      name: string;
      description?: string | null;
      hostEmail?: string | null;
      additionalHosts?: string[] | null;
      connectedGoogleEmail?: string | null;
      timezone?: string;
    }>(`${SCHEDULING_API}/scheduling/calendars/${input.id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return mapCalendar(r);
  }
  const r = await customFetch<{
    id: number;
    name: string;
    description?: string | null;
    hostEmail?: string | null;
    additionalHosts?: string[] | null;
    connectedGoogleEmail?: string | null;
    timezone?: string;
  }>(`${SCHEDULING_API}/scheduling/calendars`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return mapCalendar(r);
}

export async function openGoogleConnectPopup(): Promise<void> {
  const { url } = await customFetch<{ url: string }>(
    `${SCHEDULING_API}/scheduling/google/connect-url?returnTo=connections-calendar&returnOrigin=${encodeURIComponent(window.location.origin)}`,
  );
  window.open(url, "snapserve-google-oauth", "width=500,height=650");
}

export async function linkGoogleToCalendar(
  calendarId: number,
  connectionId: string,
): Promise<void> {
  await customFetch(`${SCHEDULING_API}/scheduling/calendars/${calendarId}/google-connection`, {
    method: "PATCH",
    body: JSON.stringify({ connectionId }),
  });
}

export async function createMeeting(input: {
  calendarId: number;
  name: string;
  durationMinutes: number;
  description?: string;
}): Promise<MeetingInfo> {
  const slug = slugifyMeetingName(input.name);
  const r = await customFetch<{
    id: number;
    calendarId: number;
    name?: string;
    title?: string;
    slug: string;
    durationMinutes: number;
  }>(`${SCHEDULING_API}/scheduling/event-types`, {
    method: "POST",
    body: JSON.stringify({
      calendarId: input.calendarId,
      name: input.name.trim(),
      slug,
      description: input.description?.trim() || undefined,
      durationMinutes: input.durationMinutes,
      isActive: true,
      // Invites must include a Meet link — wizard copy promises this.
      enableGoogleMeet: true,
    }),
  });
  return mapMeeting(r);
}

type AvailabilityRow = {
  id: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive?: boolean;
};

export async function listCalendarAvailability(calendarId: number): Promise<AvailabilityRow[]> {
  const rows = await customFetch<AvailabilityRow[]>(
    `${SCHEDULING_API}/scheduling/availability?calendarId=${calendarId}`,
  );
  return Array.isArray(rows) ? rows : [];
}

export async function replaceCalendarAvailability(
  calendarId: number,
  slots: WeeklyAvailabilitySlot[],
): Promise<void> {
  const existing = await listCalendarAvailability(calendarId);
  await Promise.allSettled(
    existing.map((row) =>
      customFetch(`${SCHEDULING_API}/scheduling/availability/${row.id}`, { method: "DELETE" }),
    ),
  );
  const active = slots.filter((s) => s.isActive);
  await Promise.all(
    active.map((s) =>
      customFetch(`${SCHEDULING_API}/scheduling/availability`, {
        method: "POST",
        body: JSON.stringify({
          calendarId,
          dayOfWeek: s.dayOfWeek,
          startTime: toHhMm(s.startTime),
          endTime: toHhMm(s.endTime),
          isActive: true,
        }),
      }),
    ),
  );
}

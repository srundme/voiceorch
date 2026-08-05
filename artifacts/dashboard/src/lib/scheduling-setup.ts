/**
 * Shared API helpers for the Connections booking wizard (and reusable by Vibe).
 * Backend still uses calendars + Google + event types; UI calls them "meetings".
 */

import { customFetch } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export const SCHEDULING_API = `${BASE}/api`;

export type SchedulingCalendarInfo = {
  id: number;
  name: string;
  hostEmail: string | null;
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

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function computeBookingSetupReadiness(
  calendars: SchedulingCalendarInfo[],
  meetings: MeetingInfo[],
): BookingSetupReadiness {
  const calendar = calendars[0] ?? null;
  const googleLinked = Boolean(calendar?.connectedGoogleEmail);
  const meeting =
    (calendar ? meetings.find((m) => m.calendarId === calendar.id) : undefined)
    ?? meetings[0]
    ?? null;
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
  hostEmail?: string | null;
  connectedGoogleEmail?: string | null;
  timezone?: string;
}): SchedulingCalendarInfo {
  return {
    id: c.id,
    name: c.name,
    hostEmail: c.hostEmail ?? null,
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
    hostEmail?: string | null;
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
  timezone?: string;
}): Promise<SchedulingCalendarInfo> {
  const body = {
    name: input.name.trim(),
    hostEmail: input.hostEmail.trim(),
    isActive: true,
  };
  if (input.id != null) {
    const r = await customFetch<{
      id: number;
      name: string;
      hostEmail?: string | null;
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
    hostEmail?: string | null;
    connectedGoogleEmail?: string | null;
    timezone?: string;
  }>(`${SCHEDULING_API}/scheduling/calendars`, {
    method: "POST",
    body: JSON.stringify({
      ...body,
      timezone: input.timezone || getBrowserTimezone(),
    }),
  });
  return mapCalendar(r);
}

export async function openGoogleConnectPopup(): Promise<void> {
  const { url } = await customFetch<{ url: string }>(
    `${SCHEDULING_API}/scheduling/google/connect-url?returnTo=calendar&returnOrigin=${encodeURIComponent(window.location.origin)}`,
  );
  window.open(url, "_blank", "noopener,width=500,height=650");
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
    }),
  });
  return mapMeeting(r);
}

/**
 * Timezone helpers for Flows (schedule triggers, daily budget windows). Pure.
 */

import type { WorkflowSchedule } from "@workspace/db";

export const DEFAULT_FLOW_TZ = "Asia/Kolkata";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function safeTz(tz: string | null | undefined): string {
  const t = (tz ?? "").trim() || DEFAULT_FLOW_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: t });
    return t;
  } catch {
    return DEFAULT_FLOW_TZ;
  }
}

export function localParts(now: Date, tz?: string | null): { date: string; hhmm: string; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTz(tz),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hhmm: `${get("hour")}:${get("minute")}`,
    weekday: WEEKDAYS.indexOf(get("weekday")),
  };
}

/** UTC instant of local midnight that starts the day containing `now`. */
export function startOfLocalDay(now: Date, tz?: string | null): Date {
  const { date } = localParts(now, tz);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const wallMidnightUtc = Date.UTC(y, m - 1, d);
  // Offset of the zone at that wall time (wall − utc).
  const probe = new Date(wallMidnightUtc);
  const p = localParts(probe, tz);
  const [py, pm, pd] = p.date.split("-").map(Number) as [number, number, number];
  const [ph, pmin] = p.hhmm.split(":").map(Number) as [number, number];
  const offsetMs = Date.UTC(py, pm - 1, pd, ph, pmin) - wallMidnightUtc;
  return new Date(wallMidnightUtc - offsetMs);
}

export function nextLocalMidnight(now: Date, tz?: string | null): Date {
  const start = startOfLocalDay(now, tz);
  // +26h then snap back to that day's midnight — safe across DST shifts.
  return startOfLocalDay(new Date(start.getTime() + 26 * 3600_000), tz);
}

export function isValidHhmm(v: string | undefined): boolean {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/** Due once per local day: right weekday, at/after the time, not yet fired today. */
export function isScheduleDue(
  schedule: WorkflowSchedule | undefined,
  now: Date,
  lastFiredOn: string | null | undefined,
): { due: boolean; localDate: string } {
  const tz = schedule?.timezone;
  const { date, hhmm, weekday } = localParts(now, tz);
  if (!schedule || !isValidHhmm(schedule.time) || !Array.isArray(schedule.days)) return { due: false, localDate: date };
  const due = schedule.days.includes(weekday) && hhmm >= schedule.time && lastFiredOn !== date;
  return { due, localDate: date };
}

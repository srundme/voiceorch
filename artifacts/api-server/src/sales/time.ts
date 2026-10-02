import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const SALES_TZ = "Asia/Kolkata";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function localDateString(instant: Date, tz: string = SALES_TZ): string {
  return formatInTimeZone(instant, tz, "yyyy-MM-dd");
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isoWeekday(dateStr: string): number {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function startOfLocalDay(dateStr: string, tz: string = SALES_TZ): Date {
  return fromZonedTime(`${dateStr}T00:00:00`, tz);
}

export interface Period {
  from: string;
  to: string;
  start: Date;
  end: Date;
}

export function periodFromDates(from: string, to: string, tz: string = SALES_TZ): Period {
  return { from, to, start: startOfLocalDay(from, tz), end: startOfLocalDay(addDays(to, 1), tz) };
}

export type PeriodKind = "day" | "week" | "month" | "sprint" | "sprint_to_date";

export function periodBounds(
  kind: PeriodKind,
  dateStr: string,
  opts: { tz?: string; sprint?: { start: string; end: string } } = {},
): Period {
  const tz = opts.tz ?? SALES_TZ;
  switch (kind) {
    case "day":
      return periodFromDates(dateStr, dateStr, tz);
    case "week": {
      const from = addDays(dateStr, 1 - isoWeekday(dateStr));
      return periodFromDates(from, addDays(from, 6), tz);
    }
    case "month": {
      const from = `${dateStr.slice(0, 7)}-01`;
      const next = new Date(`${from}T00:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      return periodFromDates(from, addDays(next.toISOString().slice(0, 10), -1), tz);
    }
    case "sprint":
    case "sprint_to_date": {
      if (!opts.sprint) throw new Error("sprint period requires sprint dates");
      const to = kind === "sprint" || dateStr > opts.sprint.end ? opts.sprint.end : dateStr;
      return periodFromDates(opts.sprint.start, to < opts.sprint.start ? opts.sprint.start : to, tz);
    }
  }
}

export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function localTime(dateStr: string, hhmm: string, tz: string = SALES_TZ): Date {
  return fromZonedTime(`${dateStr}T${hhmm}:00`, tz);
}

export interface BusinessHours {
  start: string;
  end: string;
  days: number[];
}

const MAX_SCAN_DAYS = 3660;

function businessWindow(dateStr: string, hours: BusinessHours, tz: string): [number, number] | null {
  if (!hours.days.includes(isoWeekday(dateStr))) return null;
  const open = localTime(dateStr, hours.start, tz).getTime();
  const close = localTime(dateStr, hours.end, tz).getTime();
  return close > open ? [open, close] : null;
}

export function businessMinutesBetween(start: Date, end: Date, hours: BusinessHours, tz: string = SALES_TZ): number {
  if (end.getTime() <= start.getTime()) return 0;
  const last = localDateString(end, tz);
  let total = 0;
  let day = localDateString(start, tz);
  for (let i = 0; day <= last && i < MAX_SCAN_DAYS; i++, day = addDays(day, 1)) {
    const w = businessWindow(day, hours, tz);
    if (!w) continue;
    const s = Math.max(w[0], start.getTime());
    const e = Math.min(w[1], end.getTime());
    if (e > s) total += e - s;
  }
  return Math.round(total / 60_000);
}

export function addBusinessMinutes(start: Date, minutes: number, hours: BusinessHours, tz: string = SALES_TZ): Date {
  if (!hours.days.length) return new Date(start.getTime() + minutes * 60_000);
  let remaining = minutes * 60_000;
  let day = localDateString(start, tz);
  for (let i = 0; i < MAX_SCAN_DAYS; i++, day = addDays(day, 1)) {
    const w = businessWindow(day, hours, tz);
    if (!w) continue;
    const s = Math.max(w[0], start.getTime());
    if (s >= w[1]) continue;
    if (remaining <= w[1] - s) return new Date(s + remaining);
    remaining -= w[1] - s;
  }
  return new Date(start.getTime() + minutes * 60_000);
}

export function inPeriod(instant: Date | null | undefined, period: Period): boolean {
  if (!instant) return false;
  const t = instant.getTime();
  return t >= period.start.getTime() && t < period.end.getTime();
}

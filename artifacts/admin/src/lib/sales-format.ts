export const SALES_TZ = "Asia/Kolkata";
const IST_OFFSET_MINUTES = 330;

const inrWhole = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const inrExact = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intIN = new Intl.NumberFormat("en-IN");

/** Integer paise → "₹12,50,000" (Indian grouping; paise shown only when non-zero). */
export function formatPaise(paise: number | null | undefined, fallback = "—"): string {
  if (paise == null || !Number.isFinite(paise)) return fallback;
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const text = abs % 100 === 0 ? inrWhole.format(abs / 100) : inrExact.format(abs / 100);
  return negative ? `-${text}` : text;
}

export function formatCount(n: number | null | undefined, fallback = "—"): string {
  if (n == null || !Number.isFinite(n)) return fallback;
  return intIN.format(n);
}

/** "25,000" / "25000.50" / "₹ 1,25,000" → paise. Returns null for blank or invalid input. */
export function rupeesToPaise(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input).replace(/[₹,\s]/g, "");
  if (!s) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function paiseToRupeesInput(paise: number | null | undefined): string {
  if (paise == null) return "";
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(digits)}%`;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-IN", { timeZone: SALES_TZ, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

/** UTC timestamp → "3 Oct 2026, 2:30 pm" in Asia/Kolkata. */
export function formatDateTimeIST(value: string | Date | null | undefined, fallback = "—"): string {
  const d = toDate(value);
  if (!d) return fallback;
  return fmt({ day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
}

export function formatTimeIST(value: string | Date | null | undefined, fallback = "—"): string {
  const d = toDate(value);
  if (!d) return fallback;
  return fmt({ hour: "numeric", minute: "2-digit", hour12: true }).format(d);
}

export function formatDayIST(value: string | Date | null | undefined, fallback = "—"): string {
  const d = toDate(value);
  if (!d) return fallback;
  return fmt({ weekday: "short", day: "numeric", month: "short" }).format(d);
}

/** "2026-10-03" (a calendar date, no timezone) → "Sat, 3 Oct 2026". */
export function formatDateOnly(date: string | null | undefined, fallback = "—", withWeekday = true): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fallback;
  const d = new Date(`${date}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    ...(withWeekday ? { weekday: "short" as const } : {}),
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** Calendar date (YYYY-MM-DD) for an instant, as seen in Asia/Kolkata. */
export function istDateString(value: string | Date = new Date()): string {
  const d = toDate(value) ?? new Date();
  const shifted = new Date(d.getTime() + IST_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

export function todayIST(now: Date = new Date()): string {
  return istDateString(now);
}

export function addDaysToDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday (Mon=1 … Sun=7) of a YYYY-MM-DD date. */
export function isoWeekdayOf(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** <input type="datetime-local"> value (IST wall clock) → UTC ISO string. */
export function istLocalToIso(local: string | null | undefined): string | null {
  if (!local) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(local);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3] ?? "00"}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** UTC ISO → "YYYY-MM-DDTHH:mm" in IST, for <input type="datetime-local">. */
export function isoToIstLocal(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "";
  return new Date(d.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 16);
}

export function nowIstLocal(offsetMinutes = 0): string {
  return isoToIstLocal(new Date(Date.now() + offsetMinutes * 60_000));
}

/**
 * Normalises a spreadsheet cell into an ISO timestamp with offset.
 * Values that already carry an offset are kept; bare dates/times are read as IST.
 */
export function cellToIsoDateTime(cell: string | null | undefined): string | null {
  const s = (cell ?? "").trim();
  if (!s) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) && /\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) {
    const [, y, mo, da, h = "00", mi = "00", se = "00"] = m;
    return istLocalToIso(`${y}-${mo}-${da}T${h.padStart(2, "0")}:${mi}:${se}`);
  }
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) {
    const [, da, mo, y, h = "00", mi = "00", se = "00"] = m;
    return istLocalToIso(`${y}-${mo!.padStart(2, "0")}-${da!.padStart(2, "0")}T${h.padStart(2, "0")}:${mi}:${se}`);
  }
  return null;
}

/** Minutes → "45m", "2h 5m", "3d 4h". */
export function formatMinutes(minutes: number | null | undefined, fallback = "—"): string {
  if (minutes == null || !Number.isFinite(minutes)) return fallback;
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) {
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? `${h}h ${rem}m` : `${h}h`;
  }
  const d = Math.floor(m / (60 * 24));
  const h = Math.floor((m % (60 * 24)) / 60);
  return h ? `${d}d ${h}h` : `${d}d`;
}

/** "just now", "5m ago", "in 2h", "3d ago". */
export function formatRelative(value: string | Date | null | undefined, now: Date = new Date(), fallback = "—"): string {
  const d = toDate(value);
  if (!d) return fallback;
  const diffMin = Math.round((d.getTime() - now.getTime()) / 60_000);
  if (Math.abs(diffMin) < 1) return "just now";
  const text = formatMinutes(Math.abs(diffMin));
  return diffMin < 0 ? `${text} ago` : `in ${text}`;
}

export function isPast(value: string | Date | null | undefined, now: Date = new Date()): boolean {
  const d = toDate(value);
  return d != null && d.getTime() < now.getTime();
}

export function titleCase(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function humanize(s: string | null | undefined): string {
  if (!s) return "";
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Pure helpers for Automatic Calls sheet loops:
 * Callback detection, default callback time (next day 10:00 IST), booking field format.
 */

import { addDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

const IST = "Asia/Kolkata";

const CALLBACK_RE =
  /\b(?:callback|call\s*back|call\s+(?:me\s+)?later|demo\s+follow(?:[\s-]*up)?(?:\s+session)?|follow[\s-]*up\s+session)\b|\bschedule\b[\s\S]{0,40}\bcall\b/i;

const BOOKED_RE =
  /\b(?:booked|booking[_ ]confirmed|appointment[_ ]booked|meeting[_ ]booked|sale[_ ]closed)\b/i;

/** Case-insensitive match on disposition / summary / status for callback intent. */
export function isCallbackDisposition(
  ...texts: Array<string | null | undefined>
): boolean {
  const blob = texts.filter((t) => typeof t === "string" && t.trim()).join(" ");
  if (!blob.trim()) return false;
  return CALLBACK_RE.test(blob);
}

/** True when hangup writeback should keep Status = Booked instead of Completed. */
export function isBookedDisposition(
  ...texts: Array<string | null | undefined>
): boolean {
  const blob = texts.filter((t) => typeof t === "string" && t.trim()).join(" ");
  if (!blob.trim()) return false;
  return BOOKED_RE.test(blob);
}

/**
 * Next calendar day 10:00 Asia/Kolkata as a UTC Date.
 * Used when disposition asks for a callback without an explicit timestamp.
 */
export function defaultNextDayCallbackAt(now: Date = new Date()): Date {
  const istNow = toZonedTime(now, IST);
  const nextDay = addDays(istNow, 1);
  const y = nextDay.getFullYear();
  const m = String(nextDay.getMonth() + 1).padStart(2, "0");
  const d = String(nextDay.getDate()).padStart(2, "0");
  return fromZonedTime(`${y}-${m}-${d}T10:00:00`, IST);
}

/** Prefer structured disposition fields; ignore free-form “Tuesday 4pm”. */
export function extractExplicitCallbackAt(disp: unknown): Date | null {
  if (!disp || typeof disp !== "object") return null;
  const obj = disp as Record<string, unknown>;
  for (const k of [
    "callback_at",
    "callbackAt",
    "scheduled_at",
    "scheduledAt",
    "follow_up_at",
    "followUpAt",
    "next_follow_up",
    "nextFollowUp",
  ]) {
    const v = obj[k];
    if (v == null) continue;
    const d = v instanceof Date ? v : new Date(String(v));
    if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now() - 60_000) return d;
  }
  return null;
}

/** Canonical sheet header for callback / demo follow datetime. */
export const FOLLOW_UP_HEADER = "Follow-up";

/** Map stored "Next Follow-up" / Meeting Time onto Follow-up. */
export function followUpColumnName(raw?: string | null): string {
  const v = (raw ?? "").trim();
  if (!v || /^next\s*follow[-\s]*up$/i.test(v) || /^meeting\s*time$/i.test(v)) {
    return FOLLOW_UP_HEADER;
  }
  return v;
}

/** IST display: date + time + AM/PM for Follow-up cells. */
export function formatSheetIst(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  const raw = date.toLocaleString("en-IN", {
    timeZone: IST,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return raw.replace(/\b(am|pm)\b/gi, (m) => m.toUpperCase());
}

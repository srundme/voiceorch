/**
 * Pure helpers for Automatic Calls sheet loops:
 * Callback detection, default callback time (next day 10:00 IST), booking field format.
 */

import { addDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

const IST = "Asia/Kolkata";

const CALLBACK_RE =
  /\b(?:callback|call\s*back|call\s+(?:me\s+)?later)\b|\bschedule\b[\s\S]{0,40}\bcall\b/i;

/** Case-insensitive match on disposition / summary / status for callback intent. */
export function isCallbackDisposition(
  ...texts: Array<string | null | undefined>
): boolean {
  const blob = texts.filter((t) => typeof t === "string" && t.trim()).join(" ");
  if (!blob.trim()) return false;
  return CALLBACK_RE.test(blob);
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

/** IST display string for Meeting Time / Next Follow-up cells. */
export function formatSheetIst(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-IN", {
    timeZone: IST,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

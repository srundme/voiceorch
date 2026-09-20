/**
 * Spoken callback confirmation.
 *
 * The system must store an absolute ISO time, but the agent must NOT read that
 * calendar date out loud. Callers say "tomorrow" / "நாளை" / "कल" — the spoken
 * confirm should echo that, not "Monday, 21 September 2026" or "21/09/2026".
 */

function ymdInZone(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function dayDelta(fromYmd: string, toYmd: string): number {
  const a = Date.UTC(+fromYmd.slice(0, 4), +fromYmd.slice(5, 7) - 1, +fromYmd.slice(8, 10));
  const b = Date.UTC(+toYmd.slice(0, 4), +toYmd.slice(5, 7) - 1, +toYmd.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

function weekdayName(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(date);
}

/** Relative day-word the caller actually said, if any. */
export function relativeDayFromCaller(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (/day after tomorrow|நாளை\s*மறுநாள்|மறுநாள்|परसों/i.test(t)) return "the day after tomorrow";
  if (/\btomorrow\b|நாளைக்கு|நாளை/i.test(t)) return "tomorrow";
  if (/\bकल\b|\bkal\b/i.test(t)) return "tomorrow";
  if (/\btonight\b|இன்னைக்கு\s*இரவு|இன்று\s*இரவு|आज\s*रात/i.test(t)) return "tonight";
  if (/\btoday\b|இன்னைக்கு|இன்று|\bआज\b/i.test(t)) return "today";
  const week = t.match(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  );
  if (week?.[1]) return week[1].toLowerCase();
  return null;
}

/** Clock / time-of-day the caller named — not a calendar date. */
export function clockFromCaller(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const clock = t.match(
    /\b(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|o'?clock))\b/i,
  );
  if (clock?.[1]) return clock[1].replace(/\s+/g, " ").trim();
  if (/\bmorning\b|காலை/i.test(t)) return "morning";
  if (/\bafternoon\b|மதியம்/i.test(t)) return "afternoon";
  if (/\bevening\b|மாலை/i.test(t)) return "evening";
  if (/\bnight\b|இரவு/i.test(t)) return "night";
  return null;
}

export function callerUsedCalendarDate(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\b\d{1,2}[/.\\-]\d{1,2}(?:[/.\\-]\d{2,4})?\b/.test(t)) return true;
  if (
    /\b(?:january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(
      t,
    ) && /\d/.test(t)
  ) {
    return true;
  }
  return false;
}

function relativeDayFromSchedule(scheduledAt: Date, tz: string, now = new Date()): string {
  const delta = dayDelta(ymdInZone(now, tz), ymdInZone(scheduledAt, tz));
  if (delta <= 0) return "today";
  if (delta === 1) return "tomorrow";
  if (delta === 2) return "the day after tomorrow";
  return weekdayName(scheduledAt, tz);
}

/** Phrase the agent should say — never a calendar date, month, or year. */
export function spokenCallbackWhen(
  callerText: string,
  scheduledAt: Date,
  tz: string,
  now = new Date(),
): string {
  const day = relativeDayFromCaller(callerText) ?? relativeDayFromSchedule(scheduledAt, tz, now);
  const clock = clockFromCaller(callerText);
  if (callerUsedCalendarDate(callerText) && !relativeDayFromCaller(callerText)) {
    // They named a date themselves — still drop the year; keep weekday + clock.
    const wd = weekdayName(scheduledAt, tz);
    return clock ? `${wd} at ${clock}` : wd;
  }
  if (day && clock) return `${day} at ${clock}`;
  return day;
}

export function buildScheduleCallbackSpeakInstruction(opts: {
  callerText: string;
  notes?: string;
  scheduledAt: Date;
  tz: string;
  now?: Date;
}): string {
  const source = `${opts.callerText} ${opts.notes ?? ""}`.trim();
  const when = spokenCallbackWhen(source, opts.scheduledAt, opts.tz, opts.now);
  return (
    `Callback recorded internally. When you SPEAK, confirm in the caller's words: "${when}". ` +
    `Example: "Okay, I'll call you ${when}." Speak in the caller's language. ` +
    `Do NOT say any calendar date, month, year, or slash date. ` +
    `The internal timestamp is for the system only — never read it out.`
  );
}

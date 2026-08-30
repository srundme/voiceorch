import { formatInTimeZone } from "date-fns-tz";

/**
 * Resolve the day/time phrasing callers actually use into a calendar-local date
 * and clock time.
 *
 * Callers almost never speak ISO. On a real call the model forwards whatever it
 * heard — "tomorrow 10:45 AM", "kal ten thirty", "half past four", "next Monday
 * evening", "2nd September at 11" — so this has to read all of it. Whatever it
 * cannot resolve it declines, and the ISO/Date fallback in parsePreferredDate
 * takes over.
 *
 * Everything resolves against the CALENDAR's timezone. Day arithmetic done with
 * `Date#setDate` runs in the server's local zone (UTC in production), so
 * "tomorrow" answered during an early-morning IST call lands on the wrong day.
 */

export type PartOfDay = "morning" | "afternoon" | "evening";

export interface RelativeDateTime {
  /** Calendar-local `yyyy-MM-dd`. Always set when `time` is set. */
  date?: string;
  /** Calendar-local 24-hour `HH:mm`. */
  time?: string;
  partOfDay?: PartOfDay;
}

/** Spoken numbers reach us as words far more often than digits. */
const NUMBER_WORDS: Record<string, number> = {
  zero: 0, oh: 0,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50,
};
const TENS = new Set([20, 30, 40, 50]);

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tues: 2, tue: 2,
  wednesday: 3, weds: 3, wed: 3,
  thursday: 4, thurs: 4, thur: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

/** Longest-first so "sept" wins over "sep" and "tuesday" over "tues". */
function alternation(keys: string[]): string {
  return keys.sort((a, b) => b.length - a.length).join("|");
}

const WEEKDAY_RE = new RegExp(`\\b(next|this|coming)?\\s*(${alternation(Object.keys(WEEKDAYS))})\\b`);
const MONTH_ALT = alternation(Object.keys(MONTHS));
const DAY_THEN_MONTH = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_ALT})\\b`);
const MONTH_THEN_DAY = new RegExp(`\\b(${MONTH_ALT})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`);

const RELATIVE_MINUTES = /\b(?:in|after)\s+(?:(\d{1,3})|an?)\s*(minutes?|mins?|hours?|hrs?|hr)\b/;
const HALF_QUARTER = /\b(half|quarter)\s+(past|to)\s+(\d{1,2})\s*(am|pm)?\b/;
const CLOCK_WITH_MINUTES = /\b(\d{1,2})\s*[:.]\s*(\d{2})\s*(am|pm)?\b/;
const CLOCK_SPACED_MINUTES = /\b(\d{1,2})\s+(\d{2})\s*(am|pm)?\b/;
const CLOCK_HOUR_ONLY = /\b(\d{1,2})\s*(am|pm)\b/;
const BARE_HOUR_ANCHORED = /\b(?:at|by|around|about)\s+(\d{1,2})\b/;
const BARE_HOUR = /\b(\d{1,2})\b/;

/** An explicit calendar date belongs to the ISO path, not here. */
const ABSOLUTE_DATE = /\d{4}-\d{2}-\d{2}/;

const TOMORROW = /\b(tomorrow|tommorow|tmrw|tmr|tom|kal|kaltak|naalai|naalaikku|nalai|कल|நாளை)\b/;
const DAY_AFTER = /\b(day after tomorrow|day after|parso|parson|parsoon|परसों|நாளன்று)\b/;
const TODAY = /\b(today|todays|aaj|aj|innaiku|inniku|indru|intha naal|आज|இன்று)\b/;
const TONIGHT = /\b(tonight|aaj raat|இன்று இரவு)\b/;
const NEXT_WEEK = /\bnext week\b/;
const WEEKEND = /\b(this |next |coming )?weekend\b/;

const MORNING = /\b(morning|before lunch|first thing|subah|savere|kaalai|सुबह|காலை)\b/;
const AFTERNOON = /\b(afternoon|after lunch|lunch ?time|midday|dopahar|madhiyam|दोपहर|மதியம்)\b/;
const EVENING = /\b(evening|tonight|night|end of (the )?day|eod|shaam|sham|raat|maalai|iravu|शाम|रात|மாலை|இரவு)\b/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Shift a `yyyy-MM-dd` by whole days. Date.UTC normalizes month/year rollover. */
function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

/** "ten thirty" → "10 30", "quarter past ten" → "quarter past 10". */
function digitizeNumberWords(text: string): string {
  const tokens = text.split(" ");
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const value = NUMBER_WORDS[tokens[i]!];
    if (value === undefined) {
      out.push(tokens[i]!);
      continue;
    }
    const next = NUMBER_WORDS[tokens[i + 1] ?? ""];
    // "ten forty five" → 10 45, "ten oh five" → 10 05.
    if (next !== undefined && next >= 1 && next <= 9 && (TENS.has(value) || value === 0)) {
      out.push(value === 0 ? `0${next}` : String(value + next));
      i++;
    } else {
      out.push(String(value));
    }
  }
  return out.join(" ");
}

function stripFirst(text: string, match: string): string {
  return text.replace(match, " ").replace(/\s+/g, " ").trim();
}

/** Resolve a bare day+month to the next occurrence, so "2 September" is never year 2001. */
function resolveMonthDay(month: number, day: number, todayYmd: string): string | undefined {
  const year = Number(todayYmd.slice(0, 4));
  for (const candidateYear of [year, year + 1]) {
    const probe = new Date(Date.UTC(candidateYear, month - 1, day));
    if (probe.getUTCMonth() !== month - 1) return undefined; // e.g. 30 February
    const ymd = probe.toISOString().slice(0, 10);
    if (ymd >= todayYmd) return ymd;
  }
  return undefined;
}

export function parseRelativeDateTime(
  raw: string,
  tz: string,
  now: Date = new Date(),
): RelativeDateTime | null {
  let rest = digitizeNumberWords(
    raw
      .toLowerCase()
      .replace(/\ba\.\s*m\.?/g, "am")
      .replace(/\bp\.\s*m\.?/g, "pm")
      .replace(/[,]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
  if (!rest || ABSOLUTE_DATE.test(rest)) return null;

  const todayYmd = formatInTimeZone(now, tz, "yyyy-MM-dd");

  // "in an hour", "in 30 minutes" — relative to now, so resolve it directly.
  const relMinutes = RELATIVE_MINUTES.exec(rest);
  if (relMinutes) {
    const amount = relMinutes[1] ? Number(relMinutes[1]) : 1;
    const isHours = relMinutes[2]!.startsWith("h");
    const target = new Date(now.getTime() + amount * (isHours ? 60 : 1) * 60_000);
    return {
      date: formatInTimeZone(target, tz, "yyyy-MM-dd"),
      time: formatInTimeZone(target, tz, "HH:mm"),
      partOfDay: undefined,
    };
  }

  const hasOclock = /\bo'?\s*clock\b/.test(rest);
  if (hasOclock) rest = rest.replace(/\bo'?\s*clock\b/g, " ");

  let partOfDay: PartOfDay | undefined;
  if (MORNING.test(rest)) partOfDay = "morning";
  else if (AFTERNOON.test(rest)) partOfDay = "afternoon";
  else if (EVENING.test(rest)) partOfDay = "evening";

  // ── Day ──────────────────────────────────────────────────────────────────
  let date: string | undefined;
  const dayThenMonth = DAY_THEN_MONTH.exec(rest);
  const monthThenDay = dayThenMonth ? null : MONTH_THEN_DAY.exec(rest);
  if (dayThenMonth) {
    date = resolveMonthDay(MONTHS[dayThenMonth[2]!]!, Number(dayThenMonth[1]), todayYmd);
    rest = stripFirst(rest, dayThenMonth[0]);
  } else if (monthThenDay) {
    date = resolveMonthDay(MONTHS[monthThenDay[1]!]!, Number(monthThenDay[2]), todayYmd);
    rest = stripFirst(rest, monthThenDay[0]);
  }

  const dayAfter = date ? null : DAY_AFTER.exec(rest);
  const tomorrow = date || dayAfter ? null : TOMORROW.exec(rest);
  const today = date || dayAfter || tomorrow ? null : (TODAY.exec(rest) ?? TONIGHT.exec(rest));
  if (dayAfter) {
    date = shiftYmd(todayYmd, 2);
    rest = stripFirst(rest, dayAfter[0]);
  } else if (tomorrow) {
    date = shiftYmd(todayYmd, 1);
    rest = stripFirst(rest, tomorrow[0]);
  } else if (today) {
    date = todayYmd;
    rest = stripFirst(rest, today[0]);
  }

  if (!date) {
    const weekend = WEEKEND.exec(rest);
    const dayMatch = weekend ? null : WEEKDAY_RE.exec(rest);
    const weekday = weekend ? 6 : dayMatch ? WEEKDAYS[dayMatch[2]!] : undefined;
    if (weekday !== undefined) {
      let daysAhead = weekday - weekdayOf(todayYmd);
      if (daysAhead <= 0) daysAhead += 7;
      else if ((weekend ? weekend[1]?.trim() : dayMatch![1]) === "next") daysAhead += 7;
      date = shiftYmd(todayYmd, daysAhead);
      rest = stripFirst(rest, (weekend ?? dayMatch!)[0]);
    } else if (NEXT_WEEK.test(rest)) {
      date = shiftYmd(todayYmd, 7);
      rest = stripFirst(rest, "next week");
    }
  }

  // ── Clock time ───────────────────────────────────────────────────────────
  let hour: number | null = null;
  let minute = 0;
  let meridiem: string | undefined;

  const halfQuarter = HALF_QUARTER.exec(rest);
  const withMinutes = halfQuarter ? null : CLOCK_WITH_MINUTES.exec(rest);
  const spacedMinutes = halfQuarter || withMinutes ? null : CLOCK_SPACED_MINUTES.exec(rest);
  const hourOnly = halfQuarter || withMinutes || spacedMinutes ? null : CLOCK_HOUR_ONLY.exec(rest);

  if (halfQuarter) {
    const base = Number(halfQuarter[3]);
    const isHalf = halfQuarter[1] === "half";
    if (halfQuarter[2] === "past") {
      hour = base;
      minute = isHalf ? 30 : 15;
    } else {
      hour = base === 0 ? 23 : base - 1;
      minute = isHalf ? 30 : 45;
    }
    meridiem = halfQuarter[4];
  } else if (withMinutes) {
    hour = Number(withMinutes[1]);
    minute = Number(withMinutes[2]);
    meridiem = withMinutes[3];
  } else if (spacedMinutes && Number(spacedMinutes[2]) <= 59) {
    hour = Number(spacedMinutes[1]);
    minute = Number(spacedMinutes[2]);
    meridiem = spacedMinutes[3];
  } else if (hourOnly) {
    hour = Number(hourOnly[1]);
    meridiem = hourOnly[2];
  } else if (/\bnoon\b/.test(rest)) {
    hour = 12;
  } else if (/\bmidnight\b/.test(rest)) {
    hour = 0;
  } else {
    // A bare number is only a time when the caller anchored it — "at 6",
    // "6 o'clock", "evening 6", "tomorrow 6". Otherwise stray digits
    // would invent slots nobody asked for.
    const anchored = BARE_HOUR_ANCHORED.exec(rest);
    const bare = anchored ?? (hasOclock || partOfDay || date ? BARE_HOUR.exec(rest) : null);
    if (bare) hour = Number(bare[1]);
  }

  if (hour !== null) {
    if (meridiem === "pm") {
      if (hour < 12) hour += 12;
    } else if (meridiem === "am") {
      if (hour === 12) hour = 0;
    } else if (partOfDay === "afternoon" || partOfDay === "evening") {
      if (hour < 12) hour += 12;
    } else if (partOfDay !== "morning" && hour >= 1 && hour <= 7) {
      // Nobody books a 4 AM demo. A bare low hour on a business calendar is PM.
      hour += 12;
    }
    // Guards a false positive such as "31.08" being read as a clock time.
    if (hour > 23 || minute > 59) return null;
  }

  const time = hour !== null ? `${pad2(hour)}:${pad2(minute)}` : undefined;

  // A clock time with no day means the next occurrence of that time.
  if (!date && time) {
    date = time > formatInTimeZone(now, tz, "HH:mm") ? todayYmd : shiftYmd(todayYmd, 1);
  }

  if (!date && !partOfDay) return null;
  return { date, time, partOfDay };
}

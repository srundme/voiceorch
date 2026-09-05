/**
 * Builds a [CURRENT DATE & TIME] injection string for the LLM system prompt.
 * Uses the IANA timezone stored on the agent (e.g. "Asia/Kolkata").
 * Falls back to UTC when no timezone is configured so the LLM always knows
 * the real current date instead of guessing from its training data.
 */

function ymdInZone(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function noonUtcFromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0));
}

function formatDay(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatClock(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(date);
}

function calendarNeighbors(now: Date, tz: string): { today: string; yesterday: string; tomorrow: string } {
  const todayYmd = ymdInZone(now, tz);
  const noon = noonUtcFromYmd(todayYmd);
  return {
    today: formatDay(noon, "UTC"),
    yesterday: formatDay(new Date(noon.getTime() - 86_400_000), "UTC"),
    tomorrow: formatDay(new Date(noon.getTime() + 86_400_000), "UTC"),
  };
}

function resolveZone(timezone?: string | null): string {
  const tz = timezone?.trim() || "UTC";
  try {
    formatClock(new Date(), tz);
    return tz;
  } catch {
    return "UTC";
  }
}

export function buildDatetimeInjection(timezone?: string | null): string {
  const tz = resolveZone(timezone);
  const now = new Date();
  const { today, yesterday, tomorrow } = calendarNeighbors(now, tz);
  return (
    `[CURRENT DATE & TIME] ${formatClock(now, tz)} (${tz}). ` +
    `Today is ${today}. Yesterday was ${yesterday}. Tomorrow is ${tomorrow}. ` +
    `Any calendar date before today is already past — do not treat it as an upcoming deadline.`
  );
}

/**
 * High-attention clock for the last user turn. System-prompt date sits at the
 * end of a long prompt and Sarvam-105b-conversations often ignores it (call
 * 13980 still pitched an 25 August deadline on 27 August).
 */
export function buildTurnClockBlock(timezone?: string | null): string {
  const tz = resolveZone(timezone);
  const now = new Date();
  const { today, yesterday, tomorrow } = calendarNeighbors(now, tz);
  return (
    `[TODAY] ${formatClock(now, tz)} (${tz}). ` +
    `Yesterday was ${yesterday}. Tomorrow is ${tomorrow}. ` +
    `Today is ${today}. Dates before today are already past — do not pitch them as upcoming deadlines. ` +
    `Read back emails and phone numbers exactly as written in the caller's last message.`
  );
}

/**
 * Last-user-turn recency pin. Caller memory + the agent script sit in the
 * system prefix and weak models treat them as this-turn homework
 * (call 21818: every reply restarted the prior-call WhatsApp / plan pitch).
 */
export const THIS_TURN_INSTRUCTION =
  "[THIS TURN] Answer only the caller's latest utterance above. " +
  "Prior-call memory and the agent script are background, not a checklist. " +
  "Do not restart a prior-call pitch or re-ask a question already asked in THIS conversation unless the caller asked you to.";

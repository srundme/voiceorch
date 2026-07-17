/**
 * Timezone-aware datetime parsing for LLM-supplied callback times.
 * ─────────────────────────────────────────────────────────────────
 * When the agent schedules a callback it emits a datetime string derived from
 * relative phrasing the caller used ("call me tomorrow at 3pm"). The model
 * resolves that against the [CURRENT DATE & TIME] block (which is expressed in
 * the *business* timezone), so the string it produces is a WALL-CLOCK time in
 * that timezone — usually WITHOUT an offset, e.g. "2026-07-18T15:00:00".
 *
 * `new Date("2026-07-18T15:00:00")` parses a naive (offset-less) ISO string in
 * the SERVER's local timezone (UTC in production). That silently shifts every
 * callback by the business-timezone offset (e.g. +5:30 for IST → fires 5.5h
 * late). These helpers interpret the wall-clock in the correct IANA timezone.
 */

/** Milliseconds that `date` is offset from UTC when viewed in `tz`. */
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(
    map["year"]!,
    map["month"]! - 1,
    map["day"]!,
    map["hour"]!,
    map["minute"]!,
    map["second"]!,
  );
  return asUtc - date.getTime();
}

/** Convert a wall-clock time (as if the numbers were read off a clock in `tz`) to a real UTC instant. */
function wallClockToInstant(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  tz: string,
): Date {
  // First guess treats the wall-clock as UTC, then corrects by the tz offset at
  // that instant. One correction pass is exact except for the ~1h/year DST
  // fold/gap windows, which do not apply to India (Asia/Kolkata has no DST).
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offset = tzOffsetMs(new Date(guess), tz);
  return new Date(guess - offset);
}

/**
 * Parse an LLM-supplied datetime string, interpreting offset-less values as
 * wall-clock time in `tz`. Strings that already carry an explicit offset (or a
 * trailing `Z`) are honoured as-is. Returns null when unparseable.
 */
export function parseCallbackDateTime(raw: string | undefined | null, tz: string): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Explicit offset (Z or ±HH:MM / ±HHMM after the time component) → trust it.
  const hasExplicitOffset = /(?:z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  if (hasExplicitOffset) {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Naive "YYYY-MM-DD[ T]HH:MM[:SS]" → interpret as wall-clock in tz.
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(trimmed);
  if (m) {
    return wallClockToInstant(
      Number(m[1]),
      Number(m[2]),
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      m[6] ? Number(m[6]) : 0,
      tz,
    );
  }

  // Fallback: let the runtime try (handles date-only, RFC forms, etc.).
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Resolve the effective callback time from an LLM-supplied string.
 *  - Missing/unparseable → default to `defaultMinutesAhead` from now.
 *  - Parsed time in the past (model miscomputed the date) → clamp to a small
 *    buffer ahead so the poller does not immediately re-dial at the wrong time.
 */
export function resolveCallbackTime(
  raw: string | undefined | null,
  tz: string,
  opts: { defaultMinutesAhead?: number; minBufferMinutes?: number } = {},
): { scheduledAt: Date; wasDefaulted: boolean; wasClamped: boolean } {
  const defaultMinutesAhead = opts.defaultMinutesAhead ?? 60;
  const minBufferMinutes = opts.minBufferMinutes ?? 2;
  const now = Date.now();

  const parsed = parseCallbackDateTime(raw, tz);
  if (!parsed) {
    return {
      scheduledAt: new Date(now + defaultMinutesAhead * 60_000),
      wasDefaulted: true,
      wasClamped: false,
    };
  }
  if (parsed.getTime() <= now) {
    return {
      scheduledAt: new Date(now + minBufferMinutes * 60_000),
      wasDefaulted: false,
      wasClamped: true,
    };
  }
  return { scheduledAt: parsed, wasDefaulted: false, wasClamped: false };
}

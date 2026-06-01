/**
 * Builds a [CURRENT DATE & TIME] injection string for the LLM system prompt.
 * Uses the IANA timezone stored on the agent (e.g. "Asia/Kolkata").
 * Falls back to UTC when no timezone is configured so the LLM always knows
 * the real current date instead of guessing from its training data.
 */
export function buildDatetimeInjection(timezone?: string | null): string {
  const tz = timezone?.trim() || "UTC";
  try {
    const now = new Date();
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).format(now);
    return `[CURRENT DATE & TIME] ${formatted} (${tz})`;
  } catch {
    // If the timezone string is invalid, fall back to UTC
    const now = new Date();
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).format(now);
    return `[CURRENT DATE & TIME] ${formatted} (UTC)`;
  }
}

/**
 * Builds a [CURRENT DATE & TIME] injection string for the LLM system prompt.
 * Uses the IANA timezone stored on the agent (e.g. "Asia/Kolkata").
 * Returns null when no timezone is configured so callers can skip the injection.
 */
export function buildDatetimeInjection(timezone?: string | null): string | null {
  const tz = timezone?.trim();
  if (!tz) return null;
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
    return null;
  }
}

/**
 * LLMs (especially Sarvam positional / Gemini) often pass the requested slot as
 * `date_time`, `start_time`, or `slot` instead of `preferred_date`. Executors
 * only read preferred_date — alias those keys so the booking path actually sees
 * the time the caller asked for.
 */
export function normalizeBookingDatetimeArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const existing = args["preferred_date"];
  if (existing != null && String(existing).trim()) return args;
  const alias =
    args["date_time"]
    ?? args["datetime"]
    ?? args["start_time"]
    ?? args["slot"]
    ?? args["new_time"];
  if (alias == null || !String(alias).trim()) return args;
  return { ...args, preferred_date: String(alias) };
}

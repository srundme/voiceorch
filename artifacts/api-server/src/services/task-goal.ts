/** Pure helpers for Agent Task goal parsing (no DB). */

export type TaskGoalPrefs = {
  query?: string;
  location?: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  timePrefs?: string;
  category?: string;
  maxCandidates?: number;
  maxDialAttempts?: number;
};

/** Lightweight intent parse — extracts business query + location hints from free text. */
export function parseTaskGoal(goal: string, prefs: TaskGoalPrefs = {}): TaskGoalPrefs {
  const text = goal.trim();
  const nearMatch =
    text.match(/\b(?:near|in|around|at)\s+([A-Za-z0-9 ,.'-]{2,60})/i) ||
    text.match(/\b(?:nearby|close by)\b/i);
  let location = prefs.location;
  if (!location && nearMatch?.[1]) {
    location = nearMatch[1].replace(/[,.]\s*$/, "").trim();
  }

  let query = prefs.query;
  if (!query) {
    const cleaned = text
      .replace(/\b(find|search|look up|get|book|call|appointment|for me|please|can you|nearby|near|in|around)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    query = cleaned.slice(0, 120) || "business";
  }

  const timePrefs =
    prefs.timePrefs ||
    (text.match(/\b(?:saturday|sunday|monday|tuesday|wednesday|thursday|friday|today|tomorrow|\d{1,2}\s*(?:am|pm)|after\s+\d)/i)?.[0]
      ? text.match(/\b(?:on\s+)?(?:saturday|sunday|monday|tuesday|wednesday|thursday|friday|today|tomorrow)[^.]{0,40}/i)?.[0] ??
        text.match(/\b(?:at|after|before)?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i)?.[0] ??
        undefined
      : undefined);

  return {
    ...prefs,
    query,
    location: location || prefs.location,
    timePrefs: timePrefs || prefs.timePrefs,
    maxCandidates: prefs.maxCandidates ?? 5,
    maxDialAttempts: prefs.maxDialAttempts ?? 3,
  };
}

export function buildTaskBrief(opts: {
  goal: string;
  businessName: string;
  businessPhone: string;
  businessAddress?: string | null;
  timePrefs?: string;
}): string {
  return [
    "=== AGENT TASK BRIEF (BOOKING CALL) ===",
    `You are placing an outbound call on behalf of your user to book / inquire.`,
    `Business name: ${opts.businessName}`,
    `Business phone: ${opts.businessPhone}`,
    opts.businessAddress ? `Address: ${opts.businessAddress}` : null,
    `User goal: ${opts.goal}`,
    opts.timePrefs ? `Preferred time: ${opts.timePrefs}` : null,
    "Disclose clearly that you are calling on behalf of the user to check availability / book.",
    "Collect: confirmation of booking (or next available), time, and any confirmation number.",
    "If wrong number or business closed permanently, end politely and note the outcome.",
    "Do not invent availability — only confirm what the business says.",
  ]
    .filter(Boolean)
    .join("\n");
}

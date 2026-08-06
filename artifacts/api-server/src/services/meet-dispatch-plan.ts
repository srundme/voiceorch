/** Join 2 minutes before the booked slot. */
export const MEET_BOT_JOIN_EARLY_MS = 2 * 60 * 1000;
/** Recall guarantees on-time join when join_at is ≥10 minutes ahead. */
export const MEET_BOT_SCHEDULE_MIN_LEAD_MS = 10 * 60 * 1000;
/** How far ahead we pre-schedule bots. */
export const MEET_BOT_SCHEDULE_HORIZON_MS = 24 * 60 * 60 * 1000;
/** Ad-hoc (no join_at) window relative to slot start. */
export const MEET_BOT_ADHOC_WINDOW_MS = 3 * 60 * 1000;
/** Allow late catch-up shortly after slot start. */
export const MEET_BOT_LOOKBACK_MS = 2 * 60 * 1000;

export type MeetBotDispatchPlan =
  | { action: "skip"; reason: string }
  | { action: "immediate" }
  | { action: "schedule"; joinAt: Date };

/**
 * Pure planner — unit-tested. Decides schedule vs ad-hoc vs wait.
 */
export function planMeetBotDispatch(slotStart: Date, now = new Date()): MeetBotDispatchPlan {
  const slot = slotStart.getTime();
  const t = now.getTime();
  if (!Number.isFinite(slot)) return { action: "skip", reason: "invalid_slot" };
  if (slot < t - MEET_BOT_LOOKBACK_MS) return { action: "skip", reason: "too_late" };
  if (slot > t + MEET_BOT_SCHEDULE_HORIZON_MS) return { action: "skip", reason: "beyond_horizon" };

  const joinAt = new Date(slot - MEET_BOT_JOIN_EARLY_MS);
  const lead = joinAt.getTime() - t;

  if (lead >= MEET_BOT_SCHEDULE_MIN_LEAD_MS) {
    return { action: "schedule", joinAt };
  }
  // Last-minute: create immediately only when the slot is in the ad-hoc window.
  if (slot <= t + MEET_BOT_ADHOC_WINDOW_MS) {
    return { action: "immediate" };
  }
  return { action: "skip", reason: "wait_for_adhoc_window" };
}

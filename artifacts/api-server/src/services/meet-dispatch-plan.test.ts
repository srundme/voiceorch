import { describe, expect, it } from "vitest";
import {
  MEET_BOT_ADHOC_WINDOW_MS,
  MEET_BOT_JOIN_EARLY_MS,
  MEET_BOT_SCHEDULE_HORIZON_MS,
  MEET_BOT_SCHEDULE_MIN_LEAD_MS,
  planMeetBotDispatch,
} from "./meet-dispatch-plan.js";

describe("planMeetBotDispatch", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");

  it("schedules with join_at when ≥10m lead before join time", () => {
    const slot = new Date(now.getTime() + 60 * 60 * 1000); // 1h out
    const plan = planMeetBotDispatch(slot, now);
    expect(plan.action).toBe("schedule");
    if (plan.action === "schedule") {
      expect(plan.joinAt.getTime()).toBe(slot.getTime() - MEET_BOT_JOIN_EARLY_MS);
      expect(plan.joinAt.getTime() - now.getTime()).toBeGreaterThanOrEqual(
        MEET_BOT_SCHEDULE_MIN_LEAD_MS,
      );
    }
  });

  it("skips until ad-hoc window when join lead is under 10 minutes", () => {
    // join_at would be in 8 minutes → not scheduleable; slot still >3m away
    const slot = new Date(now.getTime() + 8 * 60 * 1000 + MEET_BOT_JOIN_EARLY_MS);
    const plan = planMeetBotDispatch(slot, now);
    expect(plan).toEqual({ action: "skip", reason: "wait_for_adhoc_window" });
  });

  it("dispatches immediately inside the 3-minute ad-hoc window", () => {
    const slot = new Date(now.getTime() + MEET_BOT_ADHOC_WINDOW_MS - 30_000);
    const plan = planMeetBotDispatch(slot, now);
    expect(plan).toEqual({ action: "immediate" });
  });

  it("skips meetings beyond the 24h horizon", () => {
    const slot = new Date(now.getTime() + MEET_BOT_SCHEDULE_HORIZON_MS + 60_000);
    expect(planMeetBotDispatch(slot, now)).toEqual({ action: "skip", reason: "beyond_horizon" });
  });

  it("skips meetings that already started too long ago", () => {
    const slot = new Date(now.getTime() - 5 * 60 * 1000);
    expect(planMeetBotDispatch(slot, now)).toEqual({ action: "skip", reason: "too_late" });
  });
});

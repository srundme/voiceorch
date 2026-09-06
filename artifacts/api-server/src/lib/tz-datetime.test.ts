import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCallbackDateTime, resolveCallbackTime } from "./tz-datetime.js";

const IST = "Asia/Kolkata";

/** Render an instant as IST wall-clock so assertions read like the agent's confirmation line. */
function inIst(d: Date): string {
  return d.toLocaleString("en-GB", {
    timeZone: IST,
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("parseCallbackDateTime", () => {
  it("reads an offset-less string as wall-clock in the business timezone", () => {
    const d = parseCallbackDateTime("2026-08-25T11:00:00", IST);
    expect(d?.toISOString()).toBe("2026-08-25T05:30:00.000Z");
  });

  it("honours an explicit offset instead of re-interpreting it", () => {
    const d = parseCallbackDateTime("2026-08-25T11:00:00Z", IST);
    expect(d?.toISOString()).toBe("2026-08-25T11:00:00.000Z");
  });

  it("returns null for junk", () => {
    expect(parseCallbackDateTime("sometime next week", IST)).toBeNull();
    expect(parseCallbackDateTime("", IST)).toBeNull();
  });
});

describe("resolveCallbackTime", () => {
  it("passes a genuine future time through untouched", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-08-24T08:46:00Z"));
    const r = resolveCallbackTime("2026-08-30T11:00:00", IST);
    expect(r).toMatchObject({ wasDefaulted: false, wasClamped: false, wasRolled: false });
    expect(inIst(r.scheduledAt)).toContain("30 Aug 2026, 11:00");
  });

  it("keeps the agreed hour and rolls to the next day when the model stamped today's date", () => {
    // Call 12541: caller agreed to 11 am, the model emitted 11:00 on the day of
    // the call, which had already passed — this used to redial 2 minutes later.
    vi.useFakeTimers().setSystemTime(new Date("2026-08-24T08:46:00Z")); // 14:16 IST
    const r = resolveCallbackTime("2026-08-24T11:00:00", IST);
    expect(r.wasRolled).toBe(true);
    expect(r.wasClamped).toBe(false);
    expect(inIst(r.scheduledAt)).toContain("25 Aug 2026, 11:00");
  });

  it("rolls across a month boundary", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-08-31T18:00:00Z"));
    const r = resolveCallbackTime("2026-08-31T09:00:00", IST);
    expect(r.wasRolled).toBe(true);
    expect(inIst(r.scheduledAt)).toMatch(/01 Sept? 2026, 09:00/);
  });

  it("clamps when the date is wrong by more than a week", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-08-24T08:46:00Z"));
    const r = resolveCallbackTime("2025-08-24T11:00:00", IST);
    expect(r.wasClamped).toBe(true);
    expect(r.wasRolled).toBe(false);
    expect(r.scheduledAt.getTime()).toBe(Date.now() + 2 * 60_000);
  });

  it("defaults an hour ahead when no time was supplied", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-08-24T08:46:00Z"));
    const r = resolveCallbackTime(undefined, IST);
    expect(r.wasDefaulted).toBe(true);
    expect(r.scheduledAt.getTime()).toBe(Date.now() + 60 * 60_000);
  });
});

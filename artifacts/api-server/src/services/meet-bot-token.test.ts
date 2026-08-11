import { beforeAll, describe, expect, it } from "vitest";
import {
  MEET_BOT_TOKEN_TTL_MS,
  checkMeetBotToken,
  meetBotTokenExp,
  signMeetBotToken,
  verifyMeetBotToken,
} from "./meet-bots.js";

beforeAll(() => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-meet-bot-tokens";
});

const HOUR = 60 * 60 * 1000;

describe("meetBotTokenExp", () => {
  it("anchors to the meeting start for a bot scheduled days ahead", () => {
    const start = new Date(Date.now() + 3 * 24 * HOUR);
    expect(meetBotTokenExp(start)).toBe(start.getTime() + MEET_BOT_TOKEN_TTL_MS);
  });

  it("outlives a meeting scheduled far in the future", () => {
    const start = new Date(Date.now() + 3 * 24 * HOUR);
    expect(meetBotTokenExp(start)).toBeGreaterThan(start.getTime());
  });

  it("anchors to now for an immediate launch", () => {
    const exp = meetBotTokenExp();
    expect(exp).toBeGreaterThan(Date.now() + MEET_BOT_TOKEN_TTL_MS - 5_000);
    expect(exp).toBeLessThanOrEqual(Date.now() + MEET_BOT_TOKEN_TTL_MS);
  });

  it("ignores a start time already in the past", () => {
    const exp = meetBotTokenExp(new Date(Date.now() - 5 * HOUR));
    expect(exp).toBeGreaterThan(Date.now() + MEET_BOT_TOKEN_TTL_MS - 5_000);
  });

  it("falls back to now for an unparseable start time", () => {
    const exp = meetBotTokenExp("not a date");
    expect(exp).toBeGreaterThan(Date.now() + MEET_BOT_TOKEN_TTL_MS - 5_000);
  });
});

describe("checkMeetBotToken", () => {
  const base = { agentId: 12, userId: "user_1", mid: "mid-1" };

  it("accepts a live token", () => {
    const token = signMeetBotToken({ ...base, exp: Date.now() + HOUR });
    const checked = checkMeetBotToken(token);
    expect(checked.ok).toBe(true);
    expect(checked.ok && checked.payload.mid).toBe("mid-1");
  });

  it("reports an expired token as expired, not invalid", () => {
    const token = signMeetBotToken({ ...base, exp: Date.now() - 1_000 });
    const checked = checkMeetBotToken(token);
    expect(checked).toEqual({ ok: false, reason: "expired" });
  });

  it("reports a tampered token as invalid", () => {
    const token = signMeetBotToken({ ...base, exp: Date.now() + HOUR });
    const checked = checkMeetBotToken(`${token}tampered`);
    expect(checked).toEqual({ ok: false, reason: "invalid" });
  });

  it("reports junk as invalid", () => {
    expect(checkMeetBotToken("garbage")).toEqual({ ok: false, reason: "invalid" });
  });

  it("keeps verifyMeetBotToken behaviour unchanged", () => {
    const live = signMeetBotToken({ ...base, exp: Date.now() + HOUR });
    const dead = signMeetBotToken({ ...base, exp: Date.now() - 1_000 });
    expect(verifyMeetBotToken(live)?.mid).toBe("mid-1");
    expect(verifyMeetBotToken(dead)).toBeNull();
  });
});

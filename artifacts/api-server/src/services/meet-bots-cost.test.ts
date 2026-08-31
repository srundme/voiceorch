import { describe, expect, it } from "vitest";
import {
  buildRecallAutomaticLeave,
  buildRecallRecordingRetention,
  detectMeetingPlatform,
  normalizeMeetingUrl,
  sanitizeRecallError,
  RECALL_EVERYONE_LEFT_TIMEOUT_SEC,
  RECALL_NOONE_JOINED_TIMEOUT_SEC,
  RECALL_WAITING_ROOM_TIMEOUT_SEC,
  RECALL_RECORDING_RETENTION_HOURS,
} from "./meet-bots.js";

describe("Recall cost-control create payload", () => {
  it("sets everyone_left / noone_joined / waiting_room timeouts", () => {
    const leave = buildRecallAutomaticLeave();
    expect(leave.everyone_left_timeout.timeout).toBe(RECALL_EVERYONE_LEFT_TIMEOUT_SEC);
    expect(leave.everyone_left_timeout.activate_after).toBe(1);
    expect(leave.noone_joined_timeout).toBe(RECALL_NOONE_JOINED_TIMEOUT_SEC);
    expect(leave.waiting_room_timeout).toBe(RECALL_WAITING_ROOM_TIMEOUT_SEC);
    expect(leave.recording_permission_denied_timeout).toBe(60);
    expect(leave.in_call_not_recording_timeout).toBe(15 * 60);
    expect(RECALL_EVERYONE_LEFT_TIMEOUT_SEC).toBe(30);
    expect(RECALL_NOONE_JOINED_TIMEOUT_SEC).toBe(600);
    expect(RECALL_WAITING_ROOM_TIMEOUT_SEC).toBe(600);
  });

  it("uses timed retention for call-log playback window", () => {
    const retention = buildRecallRecordingRetention();
    expect(retention).toEqual({ type: "timed", hours: RECALL_RECORDING_RETENTION_HOURS });
    expect(RECALL_RECORDING_RETENTION_HOURS).toBe(168);
  });

  it("detects Meet / Zoom / Teams platforms", () => {
    expect(detectMeetingPlatform("https://meet.google.com/abc-defg-hij")).toBe("google_meet");
    expect(detectMeetingPlatform("https://us05web.zoom.us/j/123")).toBe("zoom");
    expect(detectMeetingPlatform("https://teams.microsoft.com/l/meetup-join/19%3a")).toBe(
      "microsoft_teams",
    );
    expect(detectMeetingPlatform("https://example.com/room")).toBe("unknown");
  });

  it("strips Google Meet authuser query and keeps Zoom pwd", () => {
    expect(normalizeMeetingUrl("https://meet.google.com/zjm-rgzu-xfu?authuser=0")).toBe(
      "https://meet.google.com/zjm-rgzu-xfu",
    );
    expect(normalizeMeetingUrl("https://us05web.zoom.us/j/123?pwd=abc")).toBe(
      "https://us05web.zoom.us/j/123?pwd=abc",
    );
  });

  it("does not leak Cloudflare HTML in Recall errors", () => {
    expect(
      sanitizeRecallError("<!DOCTYPE html><!--[if lt IE 7]> <html class=\"no-js ie6 oldie\""),
    ).toBe("Meeting bot service is temporarily unavailable. Try again in a moment.");
  });
});

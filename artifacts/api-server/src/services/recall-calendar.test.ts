process.env["DATABASE_URL"] ??= "postgres://u:p@localhost:5432/t";

import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { buildRecallBotConfig } from "./meet-bots.js";
import { isSupportedMeetingUrl, verifySvixWebhook } from "./recall-calendar.js";

describe("meet calendar helpers", () => {
  it("accepts Meet / Zoom / Teams URLs only", () => {
    expect(isSupportedMeetingUrl("https://meet.google.com/abc-defg-hij")).toBe(true);
    expect(isSupportedMeetingUrl("https://us05web.zoom.us/j/123")).toBe(true);
    expect(isSupportedMeetingUrl("https://teams.microsoft.com/l/meetup-join/19%3a")).toBe(true);
    expect(isSupportedMeetingUrl("https://calendar.google.com/event")).toBe(false);
    expect(isSupportedMeetingUrl(null)).toBe(false);
  });

  it("omits meeting_url for calendar event bot config", () => {
    const body = buildRecallBotConfig({
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      botName: "Agent",
      pageUrl: "https://app.example.com/api/meet-bots/page?mb=x",
      ownerUserId: "user_1",
      agentId: 9,
      forCalendarEvent: true,
    });
    expect(body["meeting_url"]).toBeUndefined();
    expect(body["join_at"]).toBeUndefined();
    expect(body["bot_name"]).toBe("Agent");
    expect((body["metadata"] as { ownerUserId: string }).ownerUserId).toBe("user_1");
  });

  it("verifies Svix signatures when secret is set", () => {
    const secretBytes = Buffer.from("supersecretkey!!");
    const whsec = `whsec_${secretBytes.toString("base64")}`;
    const prev = process.env["RECALL_CALENDAR_WEBHOOK_SECRET"];
    process.env["RECALL_CALENDAR_WEBHOOK_SECRET"] = whsec;
    try {
      const id = "msg_123";
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({ event: "calendar.update", data: { calendar_id: "c1" } });
      const expected = createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${body}`).digest("base64");
      expect(
        verifySvixWebhook(body, { id, timestamp, signature: `v1,${expected}` }),
      ).toBe(true);
      expect(
        verifySvixWebhook(body, { id, timestamp, signature: "v1,deadbeef" }),
      ).toBe(false);
    } finally {
      if (prev === undefined) delete process.env["RECALL_CALENDAR_WEBHOOK_SECRET"];
      else process.env["RECALL_CALENDAR_WEBHOOK_SECRET"] = prev;
    }
  });
});

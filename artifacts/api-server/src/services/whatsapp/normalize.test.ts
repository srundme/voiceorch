import { describe, expect, it } from "vitest";
import {
  normalizeWhatsappInbound,
  isRequestCallEvent,
} from "./normalize.js";
import { buildWhatsappCallEndedPayload } from "./payload.js";

describe("normalizeWhatsappInbound", () => {
  it("parses SnapServe contract", () => {
    const ev = normalizeWhatsappInbound({
      phone: "9876543210",
      event: "request_call",
      name: "Ravi",
      button_id: "request_a_call",
    });
    expect(ev?.phone).toBe("9876543210");
    expect(ev?.name).toBe("Ravi");
    expect(ev?.event).toBe("request_call");
    expect(ev?.buttonId).toBe("request_a_call");
  });

  it("parses Meta-style interactive button", () => {
    const ev = normalizeWhatsappInbound({
      entry: [{
        changes: [{
          value: {
            contacts: [{ wa_id: "919876543210", profile: { name: "Asha" } }],
            messages: [{
              from: "919876543210",
              id: "wamid.xxx",
              interactive: { button_reply: { id: "request_a_call", title: "Request a Call" } },
            }],
          },
        }],
      }],
    });
    expect(ev?.phone).toBe("919876543210");
    expect(ev?.name).toBe("Asha");
    expect(ev?.buttonId).toBe("request_a_call");
  });

  it("returns null without phone", () => {
    expect(normalizeWhatsappInbound({ event: "request_call" })).toBeNull();
  });
});

describe("isRequestCallEvent", () => {
  const allowed = ["request_a_call", "call_me"];

  it("matches explicit event", () => {
    expect(isRequestCallEvent({
      phone: "1", event: "request_call", raw: {},
    }, allowed)).toBe(true);
  });

  it("matches allowed button id", () => {
    expect(isRequestCallEvent({
      phone: "1", event: "message", buttonId: "request_a_call", raw: {},
    }, allowed)).toBe(true);
  });

  it("rejects unrelated messages", () => {
    expect(isRequestCallEvent({
      phone: "1", event: "message", buttonId: "view_catalog", raw: {},
    }, allowed)).toBe(false);
  });
});

describe("buildWhatsappCallEndedPayload", () => {
  it("shapes call.ended with booking hint", () => {
    const payload = buildWhatsappCallEndedPayload({
      call: {
        id: 42,
        agentId: 7,
        status: "completed",
        durationSeconds: 95,
        callSummary: "Booked a demo",
        dispositionResult: { outcome: "Booked" },
        recordingUrl: "/api/storage/recordings/42",
        metadata: null,
      } as any,
      agentName: "Sales AI",
      phone: "+919876543210",
      direction: "outbound",
      meetingTime: new Date("2026-07-20T04:30:00.000Z"),
      meetLink: "https://meet.google.com/abc",
    });
    expect(payload.event).toBe("call.ended");
    expect(payload.action).toBe("send_whatsapp");
    expect(payload.template_hint).toBe("booking_confirmed");
    expect(payload.phone).toBe("+919876543210");
    expect(payload.meeting_time).toMatch(/20 Jul 2026/i);
    expect(payload.meet_link).toContain("meet.google.com");
  });
});

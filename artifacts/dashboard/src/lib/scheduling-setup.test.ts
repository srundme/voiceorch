import { describe, expect, it } from "vitest";
import {
  computeBookingSetupReadiness,
  slugifyMeetingName,
  type MeetingInfo,
  type SchedulingCalendarInfo,
} from "./scheduling-setup";

describe("slugifyMeetingName", () => {
  it("builds a booking-friendly slug", () => {
    expect(slugifyMeetingName("Consultation")).toBe("consultation");
    expect(slugifyMeetingName("30-minute Product Demo")).toBe("30-minute-product-demo");
  });

  it("falls back when empty", () => {
    expect(slugifyMeetingName("   ")).toBe("meeting");
  });
});

describe("computeBookingSetupReadiness", () => {
  const cal: SchedulingCalendarInfo = {
    id: 1,
    name: "Clinic",
    hostEmail: "doc@clinic.com",
    connectedGoogleEmail: "doc@clinic.com",
    timezone: "Asia/Kolkata",
  };
  const meeting: MeetingInfo = {
    id: 9,
    calendarId: 1,
    name: "Consultation",
    slug: "consultation",
    durationMinutes: 30,
  };

  it("reports empty workspace as not ready", () => {
    const r = computeBookingSetupReadiness([], []);
    expect(r.ready).toBe(false);
    expect(r.requiredReadyCount).toBe(0);
    expect(r.calendar).toBeNull();
    expect(r.meeting).toBeNull();
  });

  it("requires Google linked on the calendar, not just a calendar row", () => {
    const r = computeBookingSetupReadiness(
      [{ ...cal, connectedGoogleEmail: null }],
      [meeting],
    );
    expect(r.ready).toBe(false);
    expect(r.googleLinked).toBe(false);
    expect(r.requiredReadyCount).toBe(2);
  });

  it("is ready when calendar + Google + meeting exist", () => {
    const r = computeBookingSetupReadiness([cal], [meeting]);
    expect(r.ready).toBe(true);
    expect(r.requiredReadyCount).toBe(3);
    expect(r.meeting?.name).toBe("Consultation");
  });

  it("uses the selected calendar, not the first one", () => {
    const second: SchedulingCalendarInfo = {
      ...cal,
      id: 2,
      name: "Demos",
      connectedGoogleEmail: null,
    };
    const r = computeBookingSetupReadiness(
      [cal, second],
      [meeting, { ...meeting, id: 10, calendarId: 2, name: "Demo" }],
      2,
    );
    expect(r.calendar?.name).toBe("Demos");
    expect(r.googleLinked).toBe(false);
    expect(r.meeting?.name).toBe("Demo");
  });

  it("treats composing a new calendar as not selected", () => {
    const r = computeBookingSetupReadiness([cal], [meeting], null);
    expect(r.calendar).toBeNull();
    expect(r.meeting).toBeNull();
    expect(r.ready).toBe(false);
  });
});

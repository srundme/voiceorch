import { describe, expect, it } from "vitest";
import {
  computeBookingSetupReadiness,
  findBySchedulingId,
  mergeWeeklyAvailability,
  normalizeSchedulingId,
  slugifyMeetingName,
  type MeetingInfo,
  type SchedulingCalendarInfo,
} from "./scheduling-setup";

describe("normalizeSchedulingId", () => {
  it("accepts numbers and numeric strings", () => {
    expect(normalizeSchedulingId(12)).toBe(12);
    expect(normalizeSchedulingId("12")).toBe(12);
  });

  it("rejects empty values", () => {
    expect(normalizeSchedulingId(null)).toBeNull();
    expect(normalizeSchedulingId("")).toBeNull();
    expect(normalizeSchedulingId("abc")).toBeNull();
  });
});

describe("findBySchedulingId", () => {
  it("matches a numeric calendar id stored as a string", () => {
    const rows = [{ id: 7, name: "Clinic" }];
    expect(findBySchedulingId(rows, "7")?.name).toBe("Clinic");
    expect(findBySchedulingId(rows, 7)?.name).toBe("Clinic");
  });
});

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

  it("matches a calendar id stored as a string on the agent", () => {
    const r = computeBookingSetupReadiness([cal], [meeting], "1" as unknown as number);
    expect(r.calendar?.name).toBe("Clinic");
    expect(r.ready).toBe(true);
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

describe("mergeWeeklyAvailability", () => {
  it("turns off days that have no saved window", () => {
    const merged = mergeWeeklyAvailability([
      { dayOfWeek: 1, startTime: "10:00:00", endTime: "18:00", isActive: true },
    ]);
    expect(merged[0]!.isActive).toBe(false);
    expect(merged[1]).toEqual({
      dayOfWeek: 1,
      startTime: "10:00",
      endTime: "18:00",
      isActive: true,
    });
    expect(merged[5]!.isActive).toBe(false);
  });
});

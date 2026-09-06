import { describe, expect, it } from "vitest";
import { parseRelativeDateTime } from "./relative-datetime.js";

const IST = "Asia/Kolkata";
// Sunday 30 Aug 2026, 13:17 IST (07:47 UTC).
const SUNDAY_AFTERNOON = new Date("2026-08-30T07:47:00Z");

const at = (raw: string) => parseRelativeDateTime(raw, IST, SUNDAY_AFTERNOON);

describe("parseRelativeDateTime", () => {
  it("keeps the clock time the caller named alongside the day", () => {
    expect(at("tomorrow 10:45 AM")).toEqual({
      date: "2026-08-31",
      time: "10:45",
      partOfDay: undefined,
    });
  });

  it("resolves the day in the calendar timezone, not the server timezone", () => {
    // 02:00 IST on 31 Aug is still 30 Aug in UTC — "tomorrow" must be 1 Sep.
    const earlyMorningIst = new Date("2026-08-30T20:30:00Z");
    expect(parseRelativeDateTime("tomorrow", IST, earlyMorningIst)?.date).toBe("2026-09-01");
  });

  it("reads the same time however the caller words it", () => {
    for (const raw of [
      "tomorrow 10:45 am",
      "tomorrow 10.45 am",
      "tomorrow 10 45 am",
      "tomorrow ten forty five am",
      "tomorrow at quarter to eleven",
      "10:45 am tomorrow",
      "tmrw 10:45am",
      "kal ten forty five",
    ]) {
      expect(at(raw), raw).toEqual({ date: "2026-08-31", time: "10:45", partOfDay: undefined });
    }
  });

  it("reads am/pm, bare business hours, and half/quarter phrasing", () => {
    expect(at("tomorrow at 3pm")?.time).toBe("15:00");
    expect(at("tomorrow 4:30")?.time).toBe("16:30");
    expect(at("tomorrow 11:30")?.time).toBe("11:30");
    expect(at("tomorrow 4")?.time).toBe("16:00");
    expect(at("tomorrow 11 o'clock")?.time).toBe("11:00");
    expect(at("tomorrow evening 6")?.time).toBe("18:00");
    expect(at("tomorrow half past ten")?.time).toBe("10:30");
    expect(at("tomorrow quarter past four")?.time).toBe("16:15");
    expect(at("tomorrow ten thirty")?.time).toBe("10:30");
    expect(at("tomorrow around 2")?.time).toBe("14:00");
    expect(at("12 am")?.time).toBe("00:00");
    expect(at("tomorrow noon")?.time).toBe("12:00");
  });

  it("returns a part-of-day filter when no clock time is given", () => {
    expect(at("tomorrow morning")).toEqual({
      date: "2026-08-31",
      time: undefined,
      partOfDay: "morning",
    });
    expect(at("afternoon")).toEqual({ date: undefined, time: undefined, partOfDay: "afternoon" });
    expect(at("kal subah")?.partOfDay).toBe("morning");
    expect(at("tomorrow after lunch")?.partOfDay).toBe("afternoon");
    expect(at("tonight")).toEqual({ date: "2026-08-30", time: undefined, partOfDay: "evening" });
  });

  it("resolves weekday, next-week and weekend phrasing", () => {
    expect(at("tuesday")?.date).toBe("2026-09-01");
    expect(at("next tuesday")?.date).toBe("2026-09-08");
    expect(at("coming friday 2:15 pm")).toEqual({
      date: "2026-09-04",
      time: "14:15",
      partOfDay: undefined,
    });
    expect(at("day after tomorrow")?.date).toBe("2026-09-01");
    expect(at("parso")?.date).toBe("2026-09-01");
    expect(at("next week")?.date).toBe("2026-09-06");
    expect(at("this weekend")?.date).toBe("2026-09-05");
  });

  it("resolves an explicit day and month to the next occurrence", () => {
    expect(at("2nd september at 11")).toEqual({
      date: "2026-09-02",
      time: "11:00",
      partOfDay: undefined,
    });
    expect(at("sept 2")?.date).toBe("2026-09-02");
    expect(at("15 aug 4pm")).toEqual({ date: "2027-08-15", time: "16:00", partOfDay: undefined });
    expect(at("30 february")).toBeNull();
  });

  it("resolves times relative to now", () => {
    expect(at("in an hour")).toEqual({ date: "2026-08-30", time: "14:17", partOfDay: undefined });
    expect(at("in 30 minutes")?.time).toBe("13:47");
  });

  it("rolls a bare clock time to the next day once it has passed", () => {
    expect(at("10:45 am")?.date).toBe("2026-08-31");
    expect(at("4:30 pm")?.date).toBe("2026-08-30");
  });

  it("declines input the ISO path owns, and non-date text", () => {
    expect(at("2026-08-31T10:45:00+05:30")).toBeNull();
    expect(at("2026-08-31")).toBeNull();
    expect(at("31.08")).toBeNull();
    expect(at("whenever is fine")).toBeNull();
    expect(at("as soon as possible")).toBeNull();
  });
});

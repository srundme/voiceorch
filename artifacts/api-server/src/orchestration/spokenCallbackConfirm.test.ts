import { describe, expect, it } from "vitest";
import {
  buildScheduleCallbackSpeakInstruction,
  clockFromCaller,
  relativeDayFromCaller,
  spokenCallbackWhen,
} from "./spokenCallbackConfirm.js";

describe("spokenCallbackWhen", () => {
  const tz = "Asia/Kolkata";
  const sundayNoon = new Date("2026-09-20T06:30:00.000Z"); // Sun 20 Sep 2026 12:00 IST
  const mondayTen = new Date("2026-09-21T04:30:00.000Z"); // Mon 21 Sep 2026 10:00 IST

  it("echoes tomorrow instead of the calendar date", () => {
    expect(spokenCallbackWhen("call me tomorrow", mondayTen, tz, sundayNoon)).toBe("tomorrow");
    expect(spokenCallbackWhen("நாளை call பண்ணுங்க", mondayTen, tz, sundayNoon)).toBe("tomorrow");
  });

  it("keeps the clock the caller named and still skips the date", () => {
    expect(
      spokenCallbackWhen("call me tomorrow at 10 o'clock", mondayTen, tz, sundayNoon),
    ).toBe("tomorrow at 10 o'clock");
  });

  it("falls back to tomorrow from the scheduled instant when the caller was vague", () => {
    expect(spokenCallbackWhen("call me later", mondayTen, tz, sundayNoon)).toBe("tomorrow");
  });

  it("does not put year, month, or slash-date in the speak instruction", () => {
    const text = buildScheduleCallbackSpeakInstruction({
      callerText: "call me tomorrow",
      scheduledAt: mondayTen,
      tz,
      now: sundayNoon,
    });
    expect(text).toContain('confirm in the caller\'s words: "tomorrow"');
    expect(text).toMatch(/I'll call you tomorrow/);
    expect(text).not.toMatch(/2026/);
    expect(text).not.toMatch(/September|21\/09|21-09/i);
    expect(text).toMatch(/never read it out/i);
  });
});

describe("relativeDayFromCaller / clockFromCaller", () => {
  it("reads Tamil and English relative days", () => {
    expect(relativeDayFromCaller("நாளைக்கு 10 மணிக்கு")).toBe("tomorrow");
    expect(relativeDayFromCaller("call Monday morning")).toBe("monday");
    expect(clockFromCaller("call me at 10 am")).toBe("10 am");
    expect(clockFromCaller("காலைல call பண்ணுங்க")).toBe("morning");
  });
});

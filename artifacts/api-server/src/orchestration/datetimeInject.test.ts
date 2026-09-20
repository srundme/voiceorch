import { describe, expect, it } from "vitest";
import { buildDatetimeInjection, buildTurnClockBlock, THIS_TURN_INSTRUCTION } from "./datetimeInject.js";

describe("buildDatetimeInjection", () => {
  it("names today, yesterday, and tomorrow in the agent timezone", () => {
    const text = buildDatetimeInjection("Asia/Kolkata");
    expect(text).toMatch(/\[CURRENT DATE & TIME\]/);
    expect(text).toMatch(/Today is /);
    expect(text).toMatch(/Yesterday was /);
    expect(text).toMatch(/Tomorrow is /);
    expect(text).toMatch(/already past/);
    expect(text).toMatch(/Never read the calendar date/);
    expect(text).toContain("Asia/Kolkata");
  });

  it("puts the same calendar on the last-user-turn clock block", () => {
    const text = buildTurnClockBlock("Asia/Kolkata");
    expect(text).toMatch(/^\[TODAY\] /);
    expect(text).toMatch(/Yesterday was /);
    expect(text).toMatch(/Tomorrow is /);
    expect(text).toContain("Asia/Kolkata");
    expect(text).toMatch(/already past/);
    expect(text).toMatch(/echo today\/tomorrow/);
    expect(text).toMatch(/exactly as written/);
  });

  it("pins the live utterance above prior-call memory (call 21818)", () => {
    expect(THIS_TURN_INSTRUCTION).toMatch(/^\[THIS TURN\] /);
    expect(THIS_TURN_INSTRUCTION).toMatch(/latest utterance/);
    expect(THIS_TURN_INSTRUCTION).toMatch(/not a checklist/);
    expect(THIS_TURN_INSTRUCTION).not.toMatch(/WhatsApp|Supreme|Care Health/i);
  });
});

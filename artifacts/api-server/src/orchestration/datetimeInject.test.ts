import { describe, expect, it } from "vitest";
import { buildDatetimeInjection, buildTurnClockBlock } from "./datetimeInject.js";

describe("buildDatetimeInjection", () => {
  it("names today, yesterday, and tomorrow in the agent timezone", () => {
    const text = buildDatetimeInjection("Asia/Kolkata");
    expect(text).toMatch(/\[CURRENT DATE & TIME\]/);
    expect(text).toMatch(/Today is /);
    expect(text).toMatch(/Yesterday was /);
    expect(text).toMatch(/Tomorrow is /);
    expect(text).toMatch(/already past/);
    expect(text).toContain("Asia/Kolkata");
  });

  it("puts the same calendar on the last-user-turn clock block", () => {
    const text = buildTurnClockBlock("Asia/Kolkata");
    expect(text).toMatch(/^\[TODAY\] /);
    expect(text).toMatch(/Yesterday was /);
    expect(text).toMatch(/Tomorrow is /);
    expect(text).toContain("Asia/Kolkata");
    expect(text).toMatch(/already past/);
    expect(text).toMatch(/exactly as written/);
  });
});

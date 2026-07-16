import { describe, it, expect } from "vitest";
import { parseTaskGoal, buildTaskBrief } from "./task-goal.js";

describe("parseTaskGoal", () => {
  it("extracts query and location from a salon booking request", () => {
    const prefs = parseTaskGoal("Find a salon near T Nagar and book Saturday after 4pm");
    expect(prefs.location?.toLowerCase()).toContain("t nagar");
    expect(prefs.query).toBeTruthy();
    expect(prefs.timePrefs).toBeTruthy();
  });
});

describe("buildTaskBrief", () => {
  it("includes business and goal for the voice agent", () => {
    const brief = buildTaskBrief({
      goal: "Book a haircut Saturday 4pm",
      businessName: "Style Hub",
      businessPhone: "+919999999999",
      businessAddress: "T Nagar",
      timePrefs: "Saturday after 4pm",
    });
    expect(brief).toContain("Style Hub");
    expect(brief).toContain("+919999999999");
    expect(brief).toContain("AGENT TASK BRIEF");
    expect(brief).toContain("on behalf of the user");
  });
});

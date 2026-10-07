import { describe, expect, it } from "vitest";
import { toolDefsForFollowUp } from "./tool-follow-up.js";

const defs = [
  { type: "function", function: { name: "end_call" } },
  { type: "function", function: { name: "get_star_premium" } },
];
const names = (d: typeof defs) => d.map((t) => t.function.name);

describe("toolDefsForFollowUp", () => {
  it("withholds end_call right after schedule_callback", () => {
    expect(names(toolDefsForFollowUp("schedule_callback", defs))).toEqual(["get_star_premium"]);
  });

  it("keeps end_call after any other tool", () => {
    expect(names(toolDefsForFollowUp("get_star_premium", defs))).toEqual(["end_call", "get_star_premium"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  isBackgroundIntakeTool,
  resolveToolFillerPhrase,
  withoutBackgroundIntakeTools,
  intakeSpokenTools,
} from "./tool-fillers.js";

describe("resolveToolFillerPhrase", () => {
  it("speaks a calendar hold for check_availability (call 17706)", () => {
    expect(resolveToolFillerPhrase("check_availability", "en-IN")).toBe(
      "Let me check the available slots real quick…",
    );
    expect(resolveToolFillerPhrase("native_check_availability", "ta-IN")).toMatch(/ஸ்லாட்ஸ்/);
  });

  it("speaks a booking hold for book_appointment", () => {
    expect(resolveToolFillerPhrase("book_appointment", "en")).toMatch(/booking/i);
  });

  it("does not hold on instant tools", () => {
    expect(resolveToolFillerPhrase("end_call", "en")).toBeUndefined();
    expect(resolveToolFillerPhrase("next_slide", "en")).toBeUndefined();
    expect(resolveToolFillerPhrase("save_candidate_details", "en-IN")).toBeUndefined();
    expect(resolveToolFillerPhrase("set_disposition", "en")).toBeUndefined();
    expect(resolveToolFillerPhrase("finish_intake", "en")).toBeUndefined();
  });

  it("keeps speak-turn tools free of intake form writes", () => {
    expect(isBackgroundIntakeTool("save_candidate_details")).toBe(true);
    expect(isBackgroundIntakeTool("end_call")).toBe(false);
    expect(withoutBackgroundIntakeTools([
      { name: "save_candidate_details" },
      { name: "finish_intake" },
      { name: "end_call" },
    ]).map((t) => t.name)).toEqual(["finish_intake", "end_call"]);
  });

  it("hides finish_intake until screening can close", () => {
    expect(intakeSpokenTools([
      { name: "save_candidate_details" },
      { name: "finish_intake" },
      { name: "end_call" },
    ], { screeningComplete: false }).map((t) => t.name)).toEqual(["end_call"]);
    expect(intakeSpokenTools([
      { name: "save_candidate_details" },
      { name: "finish_intake" },
      { name: "end_call" },
    ], { screeningComplete: true }).map((t) => t.name)).toEqual(["finish_intake", "end_call"]);
  });
});

import { describe, expect, it } from "vitest";
import { resolveToolFillerPhrase } from "./tool-fillers.js";

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
});

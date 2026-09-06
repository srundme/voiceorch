import { describe, it, expect } from "vitest";
import {
  displayNameFromEmailLocal,
  hasNonLatinLetters,
  latinizeAttendeeName,
} from "./booking-attendee-name.js";

describe("hasNonLatinLetters", () => {
  it("detects Devanagari / Tamil", () => {
    expect(hasNonLatinLetters("किशोर कुमार")).toBe(true);
    expect(hasNonLatinLetters("முரளி")).toBe(true);
    expect(hasNonLatinLetters("Kishore Kumar")).toBe(false);
  });
});

describe("displayNameFromEmailLocal", () => {
  it("derives a Latin name from the mailbox local-part", () => {
    expect(displayNameFromEmailLocal("kishorekumarr307@gmail.com")).toBe("Kishorekumarr");
    expect(displayNameFromEmailLocal("john.doe@example.com")).toBe("John Doe");
  });

  it("rejects generic locals", () => {
    expect(displayNameFromEmailLocal("info@company.com")).toBeNull();
  });
});

describe("latinizeAttendeeName", () => {
  it("keeps English names", () => {
    expect(latinizeAttendeeName("kishore kumar", "x@y.com")).toBe("Kishore Kumar");
  });

  it("romanizes Hindi Devanagari names for email/calendar", () => {
    const out = latinizeAttendeeName("किशोर कुमार", "kishorekumarr307@gmail.com");
    // Must be Latin-only letters/spaces
    expect(hasNonLatinLetters(out)).toBe(false);
    expect(out.toLowerCase()).toMatch(/k/);
    // Prefer readable romanization or email-derived Latin — never native script
    expect(/[\u0900-\u097F]/.test(out)).toBe(false);
  });

  it("uses email when STT Devanagari is heavily mangled", () => {
    const out = latinizeAttendeeName("कशोर कमर ह", "kishorekumarr307@gmail.com");
    expect(hasNonLatinLetters(out)).toBe(false);
    // Either romanized or email-derived — both acceptable; must not be Devanagari
    expect(/[\u0900-\u097F]/.test(out)).toBe(false);
    expect(out.length).toBeGreaterThan(2);
  });

  it("romanizes Tamil names", () => {
    const out = latinizeAttendeeName("முரளி", "murali@gmail.com");
    expect(hasNonLatinLetters(out)).toBe(false);
    expect(out.length).toBeGreaterThan(2);
  });

  it("falls back to Guest when empty", () => {
    expect(latinizeAttendeeName("", null)).toBe("Guest");
  });
});

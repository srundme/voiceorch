import { describe, expect, it } from "vitest";
import {
  sanitizeAttendeeEmail,
  validateBookableEmail,
  isEmailConfirmedFlag,
} from "./booking-email-validate.js";

describe("sanitizeAttendeeEmail", () => {
  it("collapses STT spaces around @ and dots", () => {
    expect(sanitizeAttendeeEmail("ram siva @ gmail . com")).toBe("ramsiva@gmail.com");
  });

  it("trims", () => {
    expect(sanitizeAttendeeEmail("  a@b.com ")).toBe("a@b.com");
  });
});

describe("validateBookableEmail", () => {
  it("accepts a normal address", () => {
    expect(validateBookableEmail("ramsiva97465@gmail.com")).toEqual({
      ok: true,
      email: "ramsiva97465@gmail.com",
    });
  });

  it("rejects the incomplete call-14390 form", () => {
    const r = validateBookableEmail("Ram Siva9166@");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("incomplete_email");
  });

  it("rejects missing TLD", () => {
    const r = validateBookableEmail("user@gmail");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/incomplete_domain|invalid_email_format/);
  });

  it("rejects empty", () => {
    const r = validateBookableEmail("   ");
    expect(r.ok).toBe(false);
  });
});

describe("isEmailConfirmedFlag", () => {
  it("reads common truthy shapes", () => {
    expect(isEmailConfirmedFlag({ email_confirmed: true })).toBe(true);
    expect(isEmailConfirmedFlag({ email_confirmed: "yes" })).toBe(true);
    expect(isEmailConfirmedFlag({})).toBe(false);
  });
});

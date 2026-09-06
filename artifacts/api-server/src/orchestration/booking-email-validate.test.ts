import { describe, expect, it } from "vitest";
import {
  sanitizeAttendeeEmail,
  validateBookableEmail,
  isEmailConfirmedFlag,
  isEmailLocalSuffixOf,
  dropSuffixFragmentEmails,
  preferCompleteEmail,
} from "./booking-email-validate.js";

describe("sanitizeAttendeeEmail", () => {
  it("collapses STT spaces around @ and dots", () => {
    expect(sanitizeAttendeeEmail("ram siva @ gmail . com")).toBe("ramsiva@gmail.com");
  });

  it("trims", () => {
    expect(sanitizeAttendeeEmail("  a@b.com ")).toBe("a@b.com");
    expect(sanitizeAttendeeEmail("www.karraj@gmail.com")).toBe("karraj@gmail.com");
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

describe("preferCompleteEmail — call 20113 fragment vs spelled local-part", () => {
  it("detects a compact STT suffix of a reconstructed address", () => {
    expect(isEmailLocalSuffixOf("307@gmail.com", "kishorekumarr307@gmail.com")).toBe(true);
    expect(isEmailLocalSuffixOf("kishorekumarr307@gmail.com", "307@gmail.com")).toBe(false);
    expect(isEmailLocalSuffixOf("ram@gmail.com", "siva@gmail.com")).toBe(false);
  });

  it("drops the compact fragment when both are present", () => {
    expect(dropSuffixFragmentEmails(["kishorekumarr307@gmail.com", "307@gmail.com"])).toEqual([
      "kishorekumarr307@gmail.com",
    ]);
  });

  it("prefers the fully spelled address for booking and confirmation", () => {
    expect(preferCompleteEmail("307@gmail.com", "kishorekumarr307@gmail.com")).toBe(
      "kishorekumarr307@gmail.com",
    );
    expect(preferCompleteEmail("kishorekumarr307@gmail.com", "307@gmail.com")).toBe(
      "kishorekumarr307@gmail.com",
    );
  });
});

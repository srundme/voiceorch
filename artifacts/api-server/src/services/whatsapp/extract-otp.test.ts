import { describe, expect, it } from "vitest";
import { extractOtpCode } from "./extract-otp.js";

describe("extractOtpCode", () => {
  it("reads a compact 6-digit code", () => {
    expect(extractOtpCode("Your WhatsApp code is 482917")).toBe("482917");
  });

  it("joins spoken digits", () => {
    expect(extractOtpCode("The code is 4 8 2 9 1 7. Repeat, 4 8 2 9 1 7.")).toBe("482917");
  });

  it("maps spelled-out English digits", () => {
    expect(extractOtpCode("four eight two nine one seven")).toBe("482917");
  });

  it("returns null when no 6-digit sequence exists", () => {
    expect(extractOtpCode("Please hold")).toBeNull();
    expect(extractOtpCode("")).toBeNull();
  });
});

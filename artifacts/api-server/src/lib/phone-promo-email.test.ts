import { describe, expect, it } from "vitest";
import { emailPromoFingerprint } from "./phone-promo-email.js";

describe("emailPromoFingerprint", () => {
  it("treats Gmail dots, plus-tags, and googlemail as the same mailbox", () => {
    const a = emailPromoFingerprint("Siva.Kumar+promo@gmail.com");
    const b = emailPromoFingerprint("sivakumar@googlemail.com");
    const c = emailPromoFingerprint("siva.kumar@gmail.com");
    expect(a).toBe("sivakumar@gmail.com");
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it("does not strip dots on non-Gmail domains", () => {
    expect(emailPromoFingerprint("siva.kumar@company.com")).toBe("siva.kumar@company.com");
  });

  it("returns empty for missing email", () => {
    expect(emailPromoFingerprint(null)).toBe("");
    expect(emailPromoFingerprint("  ")).toBe("");
  });
});

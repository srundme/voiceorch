import { vi, describe, expect, it } from "vitest";

vi.hoisted(() => {
  process.env["DATABASE_URL"] = "postgres://test:test@127.0.0.1:5432/test";
});
import {
  maskEmail,
  calculateReferralCommission,
  calculateAudienceBonus,
  isWithinEarningWindow,
  isAttributionValid,
} from "./referral-reward.js";

describe("Affiliate & Referral Reward Calculations", () => {
  describe("maskEmail", () => {
    it("masks typical emails correctly for privacy", () => {
      expect(maskEmail("sanjay@gmail.com")).toBe("sa***@gmail.com");
      expect(maskEmail("john.doe@snapserve.ai")).toBe("jo***@snapserve.ai");
    });

    it("handles short usernames cleanly", () => {
      expect(maskEmail("ab@gmail.com")).toBe("a*@gmail.com");
      expect(maskEmail("a@gmail.com")).toBe("a*@gmail.com");
    });

    it("handles null or invalid emails gracefully", () => {
      expect(maskEmail(null)).toBe("—");
      expect(maskEmail(undefined)).toBe("—");
      expect(maskEmail("not-an-email")).toBe("not-an-email");
    });
  });

  describe("calculateReferralCommission", () => {
    it("computes 10% commission on wallet recharges", () => {
      // User adds ₹10,000 (1,000,000 paise) -> Sanjay gets ₹1,000 (100,000 paise)
      expect(calculateReferralCommission(1_000_000, 10)).toBe(100_000);
      // User adds ₹5,000 (500,000 paise) -> Sanjay gets ₹500 (50,000 paise)
      expect(calculateReferralCommission(500_000, 10)).toBe(50_000);
    });

    it("handles 0 or negative values", () => {
      expect(calculateReferralCommission(0, 10)).toBe(0);
      expect(calculateReferralCommission(-500, 10)).toBe(0);
      expect(calculateReferralCommission(100_000, 0)).toBe(0);
    });
  });

  describe("calculateAudienceBonus", () => {
    it("computes 10% first recharge audience bonus", () => {
      // User recharges ₹1,000 (100,000 paise) -> Gets ₹100 bonus (10,000 paise)
      expect(calculateAudienceBonus(100_000, 10)).toBe(10_000);
      // User recharges ₹10,000 (1,000,000 paise) -> Gets ₹1,000 bonus (100,000 paise)
      expect(calculateAudienceBonus(1_000_000, 10)).toBe(100_000);
    });
  });

  describe("isWithinEarningWindow", () => {
    it("validates within 6 months window", () => {
      const now = new Date("2026-10-06T12:00:00Z");
      // 1 month ago -> true
      const oneMonthAgo = new Date("2026-09-06T12:00:00Z");
      expect(isWithinEarningWindow(oneMonthAgo, 6, now)).toBe(true);

      // 5 months ago -> true
      const fiveMonthsAgo = new Date("2026-05-06T12:00:00Z");
      expect(isWithinEarningWindow(fiveMonthsAgo, 6, now)).toBe(true);

      // 7 months ago -> false (exceeded 6 months)
      const sevenMonthsAgo = new Date("2026-03-01T12:00:00Z");
      expect(isWithinEarningWindow(sevenMonthsAgo, 6, now)).toBe(false);
    });
  });

  describe("isAttributionValid", () => {
    it("validates 60-day click attribution", () => {
      const nowMs = 1791280000000;
      const oneDayMs = 24 * 60 * 60 * 1000;

      // Clicked 10 days ago -> valid within 60 days
      expect(isAttributionValid(nowMs - 10 * oneDayMs, 60, nowMs)).toBe(true);

      // Clicked 59 days ago -> valid within 60 days
      expect(isAttributionValid(nowMs - 59 * oneDayMs, 60, nowMs)).toBe(true);

      // Clicked 61 days ago -> expired (beyond 60 days)
      expect(isAttributionValid(nowMs - 61 * oneDayMs, 60, nowMs)).toBe(false);
    });
  });
});

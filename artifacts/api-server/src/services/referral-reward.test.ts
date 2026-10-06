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
  calculateMilestoneProgress,
  convertPaiseToMinutes,
  calculateRewardCreditsPaise,
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

  describe("convertPaiseToMinutes and calculateRewardCreditsPaise", () => {
    it("converts recharge paise to calling minutes at ₹5/min (500 paise)", () => {
      // ₹10,000 = 1,000,000 paise -> 2,000 minutes
      expect(convertPaiseToMinutes(1_000_000, 500)).toBe(2_000);
      // ₹25,000 = 2,500,000 paise -> 5,000 minutes
      expect(convertPaiseToMinutes(2_500_000, 500)).toBe(5_000);
    });

    it("converts 500 reward minutes to ₹2,500 wallet credits", () => {
      // 500 minutes * 500 paise = 250,000 paise = ₹2,500
      expect(calculateRewardCreditsPaise(500, 500)).toBe(250_000);
    });
  });

  describe("calculateMilestoneProgress (5,000-Minute Recurring Cycle)", () => {
    it("tracks progress within Cycle #1 (under 5,000 minutes)", () => {
      const p1 = calculateMilestoneProgress(0, 5000);
      expect(p1.currentCycleMinutes).toBe(0);
      expect(p1.completedCycles).toBe(0);
      expect(p1.percent).toBe(0);
      expect(p1.minutesRemaining).toBe(5000);

      const p2 = calculateMilestoneProgress(2000, 5000);
      expect(p2.currentCycleMinutes).toBe(2000);
      expect(p2.completedCycles).toBe(0);
      expect(p2.percent).toBe(40);
      expect(p2.minutesRemaining).toBe(3000);
    });

    it("triggers Milestone #1 at exactly 5,000 minutes and resets cycle to 0", () => {
      const p = calculateMilestoneProgress(5000, 5000);
      expect(p.currentCycleMinutes).toBe(0);
      expect(p.completedCycles).toBe(1);
      expect(p.percent).toBe(0);
      expect(p.minutesRemaining).toBe(5000);
    });

    it("handles rollover beyond 5,000 minutes correctly into Cycle #2", () => {
      // 5,600 minutes total -> Cycle 1 completed, 600 minutes into Cycle 2
      const p = calculateMilestoneProgress(5600, 5000);
      expect(p.currentCycleMinutes).toBe(600);
      expect(p.completedCycles).toBe(1);
      expect(p.percent).toBe(12);
      expect(p.minutesRemaining).toBe(4400);
    });

    it("triggers Milestone #2 at 10,000 minutes", () => {
      const p = calculateMilestoneProgress(10000, 5000);
      expect(p.currentCycleMinutes).toBe(0);
      expect(p.completedCycles).toBe(2);
      expect(p.percent).toBe(0);
      expect(p.minutesRemaining).toBe(5000);
    });
  });

  describe("calculateReferralCommission and calculateAudienceBonus", () => {
    it("computes 10% commission on wallet recharges", () => {
      expect(calculateReferralCommission(1_000_000, 10)).toBe(100_000);
      expect(calculateReferralCommission(500_000, 10)).toBe(50_000);
    });

    it("computes 10% first recharge audience bonus", () => {
      expect(calculateAudienceBonus(100_000, 10)).toBe(10_000);
      expect(calculateAudienceBonus(1_000_000, 10)).toBe(100_000);
    });
  });

  describe("isWithinEarningWindow and isAttributionValid", () => {
    it("validates within 6 months window", () => {
      const now = new Date("2026-10-06T12:00:00Z");
      const oneMonthAgo = new Date("2026-09-06T12:00:00Z");
      expect(isWithinEarningWindow(oneMonthAgo, 6, now)).toBe(true);

      const sevenMonthsAgo = new Date("2026-03-01T12:00:00Z");
      expect(isWithinEarningWindow(sevenMonthsAgo, 6, now)).toBe(false);
    });

    it("validates 60-day click attribution", () => {
      const nowMs = 1791280000000;
      const oneDayMs = 24 * 60 * 60 * 1000;

      expect(isAttributionValid(nowMs - 10 * oneDayMs, 60, nowMs)).toBe(true);
      expect(isAttributionValid(nowMs - 61 * oneDayMs, 60, nowMs)).toBe(false);
    });
  });
});

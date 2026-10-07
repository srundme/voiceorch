import { describe, expect, it } from "vitest";
import { STAR_PREMIUMS } from "../data/star-premiums.js";
import { fillAges, parseAges, parseRupees, parseSumInsuredLakh } from "../routes/star-premium-public.js";
import { answerStarPremium, indianNumberWords, quoteStarPremium, resolveStarZone } from "./star-premium.js";

describe("resolveStarZone", () => {
  it("maps Tamil Nadu cities per plan", () => {
    expect(resolveStarZone("super_star", "Chennai", "")).toBe("B");
    expect(resolveStarZone("super_star", "Coimbatore", "Tamil Nadu")).toBe("C");
    expect(resolveStarZone("comprehensive", "Madras", "")).toBe("C");
    expect(resolveStarZone("comprehensive", "Madurai", "")).toBe("D");
    expect(resolveStarZone("health_assure", "Chennai", "TN")).toBe("B");
    expect(resolveStarZone("health_assure", "Chengalpattu", "Tamil Nadu")).toBe("D");
  });

  it("uses state rules after city rules", () => {
    expect(resolveStarZone("super_star", "Rajkot", "Gujarat")).toBe("A");
    expect(resolveStarZone("comprehensive", "Warangal", "Telangana")).toBe("B");
    expect(resolveStarZone("health_assure", "Warangal", "Telangana")).toBe("C");
    expect(resolveStarZone("comprehensive", "Patna", "Bihar")).toBe("E");
  });
});

describe("quoteStarPremium", () => {
  it("adds each floater adult and child for Super Star", () => {
    // Zone B, 5 L: adults 31–35 4,123 and 26–30 4,003; child 0–15 2,444.
    const q = quoteStarPremium(STAR_PREMIUMS, { plan: "super_star", zone: "B", adultAges: [34, 30], childAges: [6], sumInsuredLakh: 5 });
    expect(q).toEqual({ ok: true, family: "2A+1C", sumInsuredLakh: 5, premium: 4123 + 4003 + 2444 });
  });

  it("prices a single Super Star adult from the individual table", () => {
    const q = quoteStarPremium(STAR_PREMIUMS, { plan: "super_star", zone: "C", adultAges: [28], childAges: [], sumInsuredLakh: 10 });
    expect(q).toEqual({ ok: true, family: "1A", sumInsuredLakh: 10, premium: 6060 });
  });

  it("rounds an in-between sum insured up to the next chart column", () => {
    const q = quoteStarPremium(STAR_PREMIUMS, { plan: "super_star", zone: "C", adultAges: [28], childAges: [], sumInsuredLakh: 8 });
    expect(q).toMatchObject({ ok: true, sumInsuredLakh: 10 });
  });

  it("uses the eldest age band for family plans", () => {
    const q = quoteStarPremium(STAR_PREMIUMS, { plan: "health_assure", zone: "A", adultAges: [33, 38], childAges: [], sumInsuredLakh: 5 });
    expect(q).toEqual({ ok: true, family: "2A", sumInsuredLakh: 5, premium: 15418 });
  });

  it("refuses families the chart does not price", () => {
    expect(quoteStarPremium(STAR_PREMIUMS, { plan: "super_star", zone: "B", adultAges: [60, 58, 34], childAges: [], sumInsuredLakh: 5 }).ok).toBe(false);
    expect(quoteStarPremium(STAR_PREMIUMS, { plan: "comprehensive", zone: "C", adultAges: [34], childAges: [], sumInsuredLakh: 500 }).ok).toBe(false);
  });
});

describe("answerStarPremium", () => {
  const input = { plan: "super_star" as const, zone: "B", adultAges: [34, 30], childAges: [6], sumInsuredLakh: 5 };

  it("rounds the saving down and says it in words", () => {
    const a = answerStarPremium(STAR_PREMIUMS, input, 18000);
    expect(a.saving).toBe(7000);
    expect(a.star_is_cheaper).toBe(true);
    expect(a.say).toContain("around ten thousand six hundred rupees a year");
    expect(a.say).toContain("around seven thousand rupees a year less");
    expect(a.say).not.toMatch(/\d/);
  });

  it("tells the agent not to quote Star when it is not cheaper", () => {
    const a = answerStarPremium(STAR_PREMIUMS, input, 11000);
    expect(a.star_is_cheaper).toBe(false);
    expect(a.say).toContain("Do not quote the Star price");
  });
});

describe("speech and input parsing", () => {
  it("writes Indian numbers in words", () => {
    expect(indianNumberWords(105400)).toBe("one lakh five thousand four hundred");
    expect(indianNumberWords(10600)).toBe("ten thousand six hundred");
    expect(indianNumberWords(12500000)).toBe("one crore twenty five lakh");
  });

  it("parses loose tool arguments", () => {
    expect(parseAges("34, 30 and 6")).toEqual([34, 30, 6]);
    expect(parseAges([34, "30"])).toEqual([34, 30]);
    expect(parseAges("")).toEqual([]);
    expect(fillAges([34], "2", 34)).toEqual([34, 34]);
    expect(fillAges([], 1, 10)).toEqual([10]);
    expect(fillAges([34, 30], "1", 34)).toEqual([34, 30]);
    expect(parseSumInsuredLakh("5 lakh")).toBe(5);
    expect(parseSumInsuredLakh("7.5L")).toBe(7.5);
    expect(parseSumInsuredLakh("1 crore")).toBe(100);
    expect(parseSumInsuredLakh("500000")).toBe(5);
    expect(parseRupees("18,000")).toBe(18000);
    expect(parseRupees("18k")).toBe(18000);
    expect(parseRupees("1.2 lakh")).toBe(120000);
    expect(parseRupees("")).toBeNull();
  });
});

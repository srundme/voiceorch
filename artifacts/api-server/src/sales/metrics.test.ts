import { describe, expect, it } from "vitest";
import { cashCollected, countActivityFlags, goalProgress, nearestMilestone, ratio, type ActivityFlagRow } from "./metrics.js";
import { companyDomainFromEmail, isFuzzyNameMatch, normalizeCompanyName, normalizeDomain, normalizePhone } from "./normalize.js";
import { isoWeekday, localDateString, periodBounds } from "./time.js";

const SPRINT = { start: "2026-10-03", end: "2026-11-01" };

describe("period boundaries (Asia/Kolkata)", () => {
  it("a day starts at local midnight (18:30Z the previous UTC day)", () => {
    const day = periodBounds("day", "2026-10-05");
    expect(day.start.toISOString()).toBe("2026-10-04T18:30:00.000Z");
    expect(day.end.toISOString()).toBe("2026-10-05T18:30:00.000Z");
  });

  it("weeks start on Monday", () => {
    const week = periodBounds("week", "2026-10-08");
    expect(week.from).toBe("2026-10-05");
    expect(week.to).toBe("2026-10-11");
  });

  it("months cover the calendar month", () => {
    const month = periodBounds("month", "2026-02-14");
    expect(month.from).toBe("2026-02-01");
    expect(month.to).toBe("2026-02-28");
  });

  it("sprint-to-date is clamped to the sprint", () => {
    expect(periodBounds("sprint_to_date", "2026-10-10", { sprint: SPRINT })).toMatchObject({ from: "2026-10-03", to: "2026-10-10" });
    expect(periodBounds("sprint_to_date", "2026-12-01", { sprint: SPRINT })).toMatchObject({ from: "2026-10-03", to: "2026-11-01" });
  });

  it("local date of a late-evening UTC instant rolls over to the next IST day", () => {
    expect(localDateString(new Date("2026-10-04T19:00:00Z"))).toBe("2026-10-05");
    expect(isoWeekday("2026-10-04")).toBe(7);
  });
});

describe("ratio and goals", () => {
  it("returns null with a label for zero denominators", () => {
    expect(ratio(3, 0, "Demo → pilot")).toEqual({ value: null, label: "Demo → pilot: no data (denominator is 0)" });
    expect(ratio(1, 4, "x").value).toBe(0.25);
  });

  it("goal progress never reports negative remaining", () => {
    expect(goalProgress(25, 20, "g")).toMatchObject({ remaining: 0, progress: { value: 1.25 } });
  });
});

describe("countActivityFlags", () => {
  const day = periodBounds("day", "2026-10-05");
  const base: ActivityFlagRow = {
    status: "completed",
    occurredAt: new Date("2026-10-05T05:00:00Z"),
    flagVisit: false,
    flagFirstVisit: false,
    flagBuyerConversation: false,
    flagDemo: false,
  };

  it("counts flags on completed rows inside the period only", () => {
    const counts = countActivityFlags(
      [
        { ...base, flagVisit: true, flagFirstVisit: true, flagBuyerConversation: true },
        { ...base, flagDemo: true, flagBuyerConversation: true },
        { ...base, status: "cancelled", flagDemo: true },
        { ...base, status: "no_show", flagVisit: true },
        { ...base, status: "scheduled", occurredAt: null, flagDemo: true },
        { ...base, occurredAt: new Date("2026-10-05T19:00:00Z"), flagVisit: true },
      ],
      day,
    );
    expect(counts).toEqual({ visits: 1, firstVisits: 1, conversations: 2, demos: 1 });
  });
});

describe("cashCollected", () => {
  const sprint = periodBounds("sprint", "2026-10-10", { sprint: SPRINT });

  it("sums verified receipts and adjustments with fee and tax kept separate", () => {
    const totals = cashCollected(
      [
        { status: "verified", receivedAt: new Date("2026-10-06T06:00:00Z"), feePaise: 2_500_000, taxPaise: 450_000 },
        { status: "recorded", receivedAt: new Date("2026-10-06T06:00:00Z"), feePaise: 2_500_000, taxPaise: 450_000 },
        { status: "verified", receivedAt: new Date("2026-09-30T06:00:00Z"), feePaise: 999, taxPaise: 1 },
      ],
      [{ createdAt: new Date("2026-10-07T06:00:00Z"), feeDeltaPaise: -500_000, taxDeltaPaise: -90_000, paymentStatus: "verified" }],
      sprint,
    );
    expect(totals).toEqual({ feePaise: 2_000_000, taxPaise: 360_000, totalPaise: 2_360_000 });
  });

  it("returns zeros with no data", () => {
    expect(cashCollected([], [], sprint)).toEqual({ feePaise: 0, taxPaise: 0, totalPaise: 0 });
  });
});

describe("nearestMilestone", () => {
  const targets = [
    { date: "2026-10-16", operatingPaid: 6, stretchPaid: 15 },
    { date: "2026-10-09", operatingPaid: 2, stretchPaid: 5 },
    { date: "2026-11-01", operatingPaid: 20, stretchPaid: 50 },
  ];
  it("picks the next milestone on or after the date, else the last", () => {
    expect(nearestMilestone(targets, "2026-10-09")?.date).toBe("2026-10-09");
    expect(nearestMilestone(targets, "2026-10-10")?.date).toBe("2026-10-16");
    expect(nearestMilestone(targets, "2026-12-01")?.date).toBe("2026-11-01");
    expect(nearestMilestone([], "2026-10-10")).toBeNull();
  });
});

describe("normalizers", () => {
  it("normalizes Indian phone numbers to E.164", () => {
    expect(normalizePhone("98450 12345")).toBe("+919845012345");
    expect(normalizePhone("+91-98450-12345")).toBe("+919845012345");
    expect(normalizePhone("09845012345")).toBe("+919845012345");
    expect(normalizePhone("919845012345")).toBe("+919845012345");
    expect(normalizePhone("abc")).toBeNull();
  });

  it("normalizes domains and ignores free email providers", () => {
    expect(normalizeDomain("https://www.Acme-HR.in/about?x=1")).toBe("acme-hr.in");
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(companyDomainFromEmail("ravi@acme-hr.in")).toBe("acme-hr.in");
    expect(companyDomainFromEmail("ravi@gmail.com")).toBeNull();
  });

  it("strips company suffixes and matches fuzzy names", () => {
    expect(normalizeCompanyName("Sunrise Realty Pvt. Ltd.")).toBe("sunrise realty");
    expect(isFuzzyNameMatch("sunrise realty", "sunrise realty bengaluru")).toBe(true);
    expect(isFuzzyNameMatch("abc", "abc homes")).toBe(false);
  });
});

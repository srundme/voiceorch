import { describe, expect, it } from "vitest";
import { toCsv } from "./csv.js";
import {
  mrrSummary,
  pilotAllowance,
  pilotRates,
  proposalAmounts,
  qualifyingFirstPaidAt,
  rate,
  snapshotConsistencyErrors,
  type SnapshotMetrics,
} from "./metrics.js";
import { liveTaskPlan } from "./revenue-core.js";
import { isInboundSource } from "./settings-schema.js";
import { addBusinessMinutes, addMonths, businessMinutesBetween } from "./time.js";
import { signPayload, verifySignature } from "./webhook-service.js";

const HOURS = { start: "09:30", end: "19:00", days: [1, 2, 3, 4, 5, 6] };
const snapshot = (over: Partial<SnapshotMetrics> = {}): SnapshotMetrics => ({
  attempts: 100,
  distinctRecords: 90,
  answered: 50,
  meaningful: 30,
  qualifiedPeople: 10,
  acceptedOutcomes: 5,
  callbackRequests: 4,
  confirmedAppointments: 3,
  connectedMinutes: 60,
  costPaise: 1000,
  ...over,
});

describe("rates and snapshots", () => {
  it("returns null with the numerator and denominator when the denominator is zero", () => {
    expect(rate(0, 0, "x")).toEqual({ value: null, numerator: 0, denominator: 0, label: "x" });
    expect(rate(1, 4, "x").value).toBe(0.25);
    expect(pilotRates(null).answerRate.value).toBeNull();
  });

  it("rejects inconsistent snapshots", () => {
    expect(snapshotConsistencyErrors(snapshot())).toEqual([]);
    expect(snapshotConsistencyErrors(snapshot({ answered: 120 }))).toContain("answered (120) cannot exceed attempts (100)");
    expect(snapshotConsistencyErrors(snapshot({ qualifiedPeople: 40 }))).toContain("qualifiedPeople (40) cannot exceed meaningful (30)");
    expect(snapshotConsistencyErrors(snapshot({ attempts: -1 }))).toContain("attempts must be a whole number >= 0");
  });

  it("flags over-allowance without discarding attempts", () => {
    expect(pilotAllowance({ attemptAllowance: 200, extensionAttempts: null }, 230)).toMatchObject({ revisedAllowance: 200, overAllowance: true, overBy: 30, remaining: 0, attemptsUsed: 230 });
    expect(pilotAllowance({ attemptAllowance: 200, extensionAttempts: 100 }, 230)).toMatchObject({ revisedAllowance: 300, overAllowance: false, remaining: 70 });
  });
});

describe("money", () => {
  it("computes GST separately from fees", () => {
    expect(proposalAmounts({ monthlyFeePaise: 2_500_000, setupFeePaise: 1_000_000, gstRateBps: 1800 })).toMatchObject({
      monthlyTaxPaise: 450_000,
      monthlyTotalPaise: 2_950_000,
      setupTaxPaise: 180_000,
      firstInvoiceTotalPaise: 4_130_000,
    });
  });

  it("finds the date cumulative first-month payments reach the threshold", () => {
    const a = new Date("2026-10-05T05:00:00Z");
    const b = new Date("2026-10-07T05:00:00Z");
    expect(qualifyingFirstPaidAt([{ id: 1, receivedAt: a, netFeePaise: 1_000_000 }], 2_500_000)).toBeNull();
    expect(qualifyingFirstPaidAt([{ id: 2, receivedAt: b, netFeePaise: 1_500_000 }, { id: 1, receivedAt: a, netFeePaise: 1_000_000 }], 2_500_000)).toEqual(b);
    expect(qualifyingFirstPaidAt([{ id: 1, receivedAt: a, netFeePaise: 1_000_000 }, { id: 2, receivedAt: b, netFeePaise: 1_000_000 }], 2_500_000)).toBeNull();
    expect(qualifyingFirstPaidAt([{ id: 1, receivedAt: a, netFeePaise: 9_000_000 }], null)).toBeNull();
  });

  it("keeps overdue subscriptions in MRR but counts them separately", () => {
    const m = mrrSummary(
      [
        { status: "active", monthlyFeePaise: 100, renewalDate: "2026-10-01" },
        { status: "active", monthlyFeePaise: 200, renewalDate: "2026-11-01" },
        { status: "paused", monthlyFeePaise: 400, renewalDate: "2026-09-01" },
      ],
      "2026-10-10",
    );
    expect(m).toMatchObject({ activeMrrPaise: 300, activeSubscriptions: 2, overdueMrrPaise: 100, overdueSubscriptions: 1 });
  });
});

describe("time", () => {
  it("adds months clamped to month end", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-10-15", 1)).toBe("2026-11-15");
    expect(addMonths("2026-12-10", 1)).toBe("2027-01-10");
  });

  it("counts only business minutes in Asia/Kolkata", () => {
    const satEvening = new Date("2026-10-03T13:00:00Z");
    const monMorning = new Date("2026-10-05T04:15:00Z");
    expect(businessMinutesBetween(satEvening, monMorning, HOURS)).toBe(30 + 15);
    expect(addBusinessMinutes(new Date("2026-10-03T13:20:00Z"), 15, HOURS).toISOString()).toBe("2026-10-05T04:05:00.000Z");
    expect(addBusinessMinutes(new Date("2026-10-05T05:00:00Z"), 15, HOURS).toISOString()).toBe("2026-10-05T05:15:00.000Z");
  });
});

describe("live tasks", () => {
  it("plans day 1/7/14/25 reviews and a renewal task five days before renewal", () => {
    const plan = liveTaskPlan({ id: 9, startDate: "2026-10-10", renewalDate: "2026-11-10" });
    expect(plan.map((t) => t.dedupeKey)).toEqual(["sub:9:review:d1", "sub:9:review:d7", "sub:9:review:d14", "sub:9:review:d25", "sub:9:renewal:2026-11-10"]);
    expect(plan[4]!.dueAt.toISOString()).toBe("2026-11-05T04:30:00.000Z");
  });
});

describe("inbound and webhook helpers", () => {
  it("treats every source except field visits as inbound", () => {
    expect(isInboundSource("website_form")).toBe(true);
    expect(isInboundSource("field_visit")).toBe(false);
    expect(isInboundSource(null)).toBe(false);
  });

  it("verifies HMAC signatures over the raw body", () => {
    const raw = Buffer.from('{"a":1}');
    const sig = signPayload(raw, "s3cret");
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifySignature(raw, sig, "s3cret")).toBe(true);
    expect(verifySignature(raw, sig, "other")).toBe(false);
    expect(verifySignature(Buffer.from('{"a":2}'), sig, "s3cret")).toBe(false);
    expect(verifySignature(raw, undefined, "s3cret")).toBe(false);
    expect(verifySignature(raw, "sha256=short", "s3cret")).toBe(false);
  });
});

describe("csv", () => {
  it("quotes separators and neutralises spreadsheet formulas", () => {
    const csv = toCsv(
      [
        { header: "name", value: (r: { name: string; n: number }) => r.name },
        { header: "n", value: (r: { name: string; n: number }) => r.n },
      ],
      [{ name: '=HYPERLINK("x")', n: -5 }, { name: "A, B", n: 3 }],
    );
    expect(csv).toBe('name,n\r\n"\'=HYPERLINK(""x"")",-5\r\n"A, B",3\r\n');
  });
});

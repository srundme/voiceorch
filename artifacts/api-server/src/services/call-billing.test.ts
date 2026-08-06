import { describe, expect, it } from "vitest";
import { computeProRataDebitCents, isNonBillableCallStatus } from "./call-billing.js";

describe("computeProRataDebitCents", () => {
  const rate = 500; // ₹5/min

  it("bills per-second, not full minutes", () => {
    expect(computeProRataDebitCents(9, rate)).toBe(75);   // ₹0.75
    expect(computeProRataDebitCents(30, rate)).toBe(250); // ₹2.50
    expect(computeProRataDebitCents(60, rate)).toBe(500); // ₹5.00
    expect(computeProRataDebitCents(90, rate)).toBe(750); // ₹7.50
  });

  it("does not ceil a sub-minute call to ₹5", () => {
    expect(computeProRataDebitCents(9, rate)).not.toBe(rate);
    expect(computeProRataDebitCents(9, rate)).toBeLessThan(rate);
  });

  it("returns 0 for empty duration or rate", () => {
    expect(computeProRataDebitCents(0, rate)).toBe(0);
    expect(computeProRataDebitCents(30, 0)).toBe(0);
  });
});

describe("isNonBillableCallStatus", () => {
  it("skips no-pickup / busy / failed", () => {
    expect(isNonBillableCallStatus("no_pickup")).toBe(true);
    expect(isNonBillableCallStatus("busy")).toBe(true);
    expect(isNonBillableCallStatus("failed")).toBe(true);
    expect(isNonBillableCallStatus("completed")).toBe(false);
    expect(isNonBillableCallStatus("transferred")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { computeProRataDebitCents } from "./call-billing.js";

describe("Admin V2 effective billing helpers", () => {
  it("pro-rata debit matches product expectation at ₹5/min", () => {
    const rate = 500;
    expect(computeProRataDebitCents(60, rate)).toBe(500);
    expect(computeProRataDebitCents(30, rate)).toBe(250);
    expect(computeProRataDebitCents(9, rate)).toBe(75);
  });
});

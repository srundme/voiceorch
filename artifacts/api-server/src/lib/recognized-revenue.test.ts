import { describe, expect, it } from "vitest";
import { phoneFeeDebitRaw, recognizedRevenueRaw } from "./recognized-revenue.js";

describe("recognized revenue SQL", () => {
  it("counts voice and WhatsApp DID fees plus call usage", () => {
    expect(phoneFeeDebitRaw()).toContain("%phone%");
    expect(phoneFeeDebitRaw()).toContain("%whatsapp number%");
    expect(phoneFeeDebitRaw("wt")).toContain("wt.description");
    expect(recognizedRevenueRaw()).toContain("call_debit");
    expect(recognizedRevenueRaw("wt")).toContain("wt.type = 'call_debit'");
  });
});

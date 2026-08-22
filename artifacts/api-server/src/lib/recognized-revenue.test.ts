import { describe, expect, it } from "vitest";
import {
  cardPaidDidDebitRaw,
  cashInEventRaw,
  ledgerAdjustmentRaw,
  phoneFeeDebitRaw,
  promoAdminCreditRaw,
  recognizedRevenueRaw,
  successfulTopupRaw,
  topupGrossExpr,
  topupGrossPaise,
  walletFundedPhoneDebitRaw,
  walletInflowRaw,
} from "./recognized-revenue.js";

describe("recognized revenue SQL", () => {
  it("counts voice and WhatsApp DID fees plus call usage", () => {
    expect(phoneFeeDebitRaw()).toContain("%phone%");
    expect(phoneFeeDebitRaw()).toContain("%whatsapp number%");
    expect(phoneFeeDebitRaw("wt")).toContain("wt.description");
    expect(recognizedRevenueRaw()).toContain("call_debit");
    expect(recognizedRevenueRaw("wt")).toContain("wt.type = 'call_debit'");
  });

  it("separates card cash from wallet-funded DID fees", () => {
    expect(cardPaidDidDebitRaw()).toContain("paid by card");
    expect(cardPaidDidDebitRaw()).toContain("wallet%");
    expect(walletFundedPhoneDebitRaw()).toContain("not (");
    expect(topupGrossPaise(2_600_000)).toBe(3_068_000);
  });

  it("treats GST-inclusive topups and card DIDs as cash-in events", () => {
    expect(successfulTopupRaw()).toContain("topup");
    expect(cashInEventRaw()).toContain("paid by card");
    expect(topupGrossExpr()).toContain("0.18");
  });

  it("counts signup, admin, and partner credits as wallet inflows — not cash-in", () => {
    expect(promoAdminCreditRaw()).toContain("free_credit");
    expect(promoAdminCreditRaw()).toContain("admin_credit");
    expect(walletInflowRaw()).toContain("free_credit");
    expect(walletInflowRaw()).toContain("topup");
    expect(cashInEventRaw()).not.toContain("free_credit");
    expect(ledgerAdjustmentRaw()).toContain("admin_credit");
    expect(ledgerAdjustmentRaw()).toContain("admin_debit");
  });
});

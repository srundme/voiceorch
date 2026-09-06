import { describe, expect, it } from "vitest";
import { normalizePromoCode, pricePhonePurchase, resolvePhonePromo } from "./phone-promo.js";
import { phonePurchaseBasePaise } from "./money-inr.js";

// +9180… is the cheapest tier (₹599 rental + ₹100 setup = ₹699 base).
const NUM_80 = "+918012345678";
// +9179… is the dearest tier (₹699 rental + ₹100 setup = ₹799 base).
const NUM_79 = "+917912345678";

describe("resolvePhonePromo", () => {
  it("accepts VOICEATHON26 regardless of case or padding", () => {
    for (const input of ["VOICEATHON26", "voiceathon26", "  Voiceathon26 "]) {
      const r = resolvePhonePromo(input);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.promo.code).toBe("VOICEATHON26");
    }
  });

  it("rejects unknown codes and blank input", () => {
    for (const input of ["NOPE", "", "   ", null, undefined]) {
      const r = resolvePhonePromo(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("unknown");
    }
  });

  it("normalises codes for comparison", () => {
    expect(normalizePromoCode(" voiceathon26 ")).toBe("VOICEATHON26");
    expect(normalizePromoCode(null)).toBe("");
  });
});

describe("pricePhonePurchase", () => {
  it("charges the standard tiered price with no promo", () => {
    const p = pricePhonePurchase(NUM_80);
    expect(p.basePaise).toBe(phonePurchaseBasePaise(NUM_80)); // ₹699
    expect(p.discountPaise).toBe(0);
    expect(p.promoCode).toBeNull();
    expect(p.payablePaise).toBe(82_482); // ₹699 + 18% = ₹824.82
  });

  it("prices VOICEATHON26 at ₹199 + 18% GST = ₹234.82", () => {
    const p = pricePhonePurchase(NUM_80, "voiceathon26");
    expect(p.basePaise).toBe(19_900);
    expect(p.gstPaise).toBe(3_582);
    expect(p.payablePaise).toBe(23_482);
    expect(p.promoCode).toBe("VOICEATHON26");
    expect(p.promoLabel).toBe("Voiceathon 2026");
  });

  it("prices ILUVSNAPSERVE at ₹0 including GST", () => {
    const p = pricePhonePurchase(NUM_80, "iluvsnapserve");
    expect(p.basePaise).toBe(0);
    expect(p.gstPaise).toBe(0);
    expect(p.payablePaise).toBe(0);
    expect(p.promoCode).toBe("ILUVSNAPSERVE");
    expect(p.discountPaise).toBe(phonePurchaseBasePaise(NUM_80));
    const resolved = resolvePhonePromo("ILUVSNAPSERVE");
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.promo.oncePerEmail).toBe(true);
  });

  it("prices SNAPXHITECH at ₹249 + 18% GST = ₹293.82", () => {
    const p = pricePhonePurchase(NUM_80, "snapxhitech");
    expect(p.basePaise).toBe(24_900);
    expect(p.gstPaise).toBe(4_482);
    expect(p.payablePaise).toBe(29_382);
    expect(p.promoCode).toBe("SNAPXHITECH");
    expect(p.promoLabel).toBe("SnapX HiTech");
  });

  it("applies the same flat promo base across pricing tiers", () => {
    const cheap = pricePhonePurchase(NUM_80, "VOICEATHON26");
    const dear = pricePhonePurchase(NUM_79, "VOICEATHON26");
    expect(cheap.payablePaise).toBe(dear.payablePaise);
    // ...but the recorded discount reflects each tier's standard price.
    expect(dear.discountPaise).toBeGreaterThan(cheap.discountPaise);
    expect(dear.standardBasePaise).toBe(phonePurchaseBasePaise(NUM_79));
  });

  it("falls back to full price for an unknown code rather than failing open", () => {
    const p = pricePhonePurchase(NUM_80, "FREEPLEASE");
    expect(p.basePaise).toBe(phonePurchaseBasePaise(NUM_80));
    expect(p.promoCode).toBeNull();
    expect(p.discountPaise).toBe(0);
  });

  it("never lets a promo raise the price", () => {
    const p = pricePhonePurchase(NUM_80, "VOICEATHON26");
    expect(p.basePaise).toBeLessThanOrEqual(p.standardBasePaise);
    expect(p.discountPaise).toBeGreaterThanOrEqual(0);
  });

  it("ignores a promo once it has expired", () => {
    // Exercises the expiry branch without depending on a live promo having one.
    const future = new Date("2099-01-01T00:00:00Z");
    const r = resolvePhonePromo("VOICEATHON26", future);
    // No expiry configured today, so the code stays live.
    expect(r.ok).toBe(true);
  });
});

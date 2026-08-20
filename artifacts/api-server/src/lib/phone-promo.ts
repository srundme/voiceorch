/**
 * Promo codes for first-time phone-number purchases.
 * (Updated: August 2026 for SNAPXHITECH)
 *
 * A promo replaces the standard first-purchase base (tiered rental + ₹100
 * setup) with a flat promotional base, before GST. Renewals are deliberately
 * NOT discounted — the number keeps renewing at its normal tiered price, so
 * the checkout UI must show the renewal amount separately.
 *
 * This module is the single source of truth for promo pricing. The dashboard
 * never computes a discount itself; it asks the server for a quote and then
 * the server re-prices the order at initiate time, so a stale or tampered
 * client cannot buy a number below the real promo price.
 */
import { GST_RATE, gstPortionPaise, phonePurchaseBasePaise, withGstPaise } from "./money-inr.js";

export interface PhonePromo {
  /** Canonical uppercase code. */
  code: string;
  /** Flat first-purchase base in paise, before GST. */
  basePaise: number;
  /** Human label shown in the checkout breakdown and on the invoice. */
  label: string;
  /** Optional hard stop — the code stops working at this instant. */
  expiresAt?: Date;
}

/**
 * Active promos. Add an `expiresAt` to wind one down without touching the
 * purchase path.
 */
const PROMOS: readonly PhonePromo[] = [
  {
    code: "VOICEATHON26",
    basePaise: 19_900, // ₹199 before GST → ₹234.82 payable
    label: "Voiceathon 2026",
  },
  {
    code: "SNAPXHITECH",
    basePaise: 24_900, // ₹249 before GST → ₹293.82 payable
    label: "SnapX HiTech",
  },
];

export type PromoRejection = "unknown" | "expired";

/** Normalise buyer input ("  voiceathon26 " → "VOICEATHON26"). */
export function normalizePromoCode(input: string | null | undefined): string {
  return String(input ?? "").trim().toUpperCase();
}

/**
 * Look up a promo. Returns the rejection reason instead of throwing so callers
 * can tell "no such code" from "the offer ended".
 */
export function resolvePhonePromo(
  input: string | null | undefined,
  now: Date = new Date(),
): { ok: true; promo: PhonePromo } | { ok: false; reason: PromoRejection } {
  const code = normalizePromoCode(input);
  const promo = PROMOS.find(p => p.code === code);
  if (!promo) return { ok: false, reason: "unknown" };
  if (promo.expiresAt && now >= promo.expiresAt) return { ok: false, reason: "expired" };
  return { ok: true, promo };
}

export interface PhonePurchasePricing {
  /** Taxable base actually charged, in paise. */
  basePaise: number;
  gstPaise: number;
  payablePaise: number;
  /** What the base would have been with no promo. */
  standardBasePaise: number;
  /** standardBasePaise - basePaise, never negative. */
  discountPaise: number;
  promoCode: string | null;
  promoLabel: string | null;
}

/**
 * Price a first purchase, applying `promoCode` when it resolves.
 *
 * A promo can only ever lower the price: if a promotional base somehow lands
 * above the tiered price for this number, the standard base wins.
 */
export function pricePhonePurchase(
  number: string,
  promoCode?: string | null,
  now: Date = new Date(),
): PhonePurchasePricing {
  const standardBasePaise = phonePurchaseBasePaise(number);

  const resolved = promoCode ? resolvePhonePromo(promoCode, now) : null;
  const promo = resolved?.ok ? resolved.promo : null;
  const basePaise = promo ? Math.min(promo.basePaise, standardBasePaise) : standardBasePaise;
  const discounted = promo != null && basePaise < standardBasePaise;

  return {
    basePaise,
    gstPaise: gstPortionPaise(basePaise),
    payablePaise: withGstPaise(basePaise),
    standardBasePaise,
    discountPaise: Math.max(standardBasePaise - basePaise, 0),
    promoCode: discounted ? promo!.code : null,
    promoLabel: discounted ? promo!.label : null,
  };
}

export { GST_RATE };

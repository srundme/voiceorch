/**
 * INR billing helpers.
 *
 * Wallet/ledger columns are still named `*Cents` / `amountCents` but store
 * **paise** (1 INR = 100 paise). Razorpay INR orders also expect paise.
 */

export const GST_RATE = 0.18;
export const CURRENCY_INR = "INR" as const;

/** ₹500 signup free credit */
export const SIGNUP_CREDIT_PAISE = 50_000;

/** ₹800 phone number base for first purchase (₹700 rental + ₹100 setup before GST) */
export const PHONE_BASE_PAISE = 80_000;

/** ₹700 phone number base for monthly renewals (telephony rental before GST) */
export const PHONE_RENEWAL_BASE_PAISE = 70_000;

/** Flat ₹5 / minute platform fee */
export const RATE_PAISE_PER_MIN = 500;

/** Minimum wallet top-up credit (₹100) */
export const MIN_TOPUP_PAISE = 10_000;

/** Autopay defaults */
export const AUTOPAY_THRESHOLD_PAISE = 10_000; // ₹100
export const AUTOPAY_AMOUNT_PAISE = 50_000;    // ₹500

/** GST portion for a taxable base amount in paise */
export function gstPortionPaise(basePaise: number): number {
  return Math.round(basePaise * GST_RATE);
}

/** Total payable including GST (paise) */
export function withGstPaise(basePaise: number): number {
  return basePaise + gstPortionPaise(basePaise);
}

/** First phone purchase: ₹800 + 18% GST = ₹944 */
export const PHONE_TOTAL_PAISE = withGstPaise(PHONE_BASE_PAISE);

/** Monthly renewal: ₹700 + 18% GST = ₹826 */
export const PHONE_RENEWAL_TOTAL_PAISE = withGstPaise(PHONE_RENEWAL_BASE_PAISE);

export function formatInr(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}₹${(abs / 100).toFixed(2)}`;
}

export function formatInrCompact(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const rupees = abs / 100;
  const body = Number.isInteger(rupees) ? String(rupees) : rupees.toFixed(2);
  return `${sign}₹${body}`;
}

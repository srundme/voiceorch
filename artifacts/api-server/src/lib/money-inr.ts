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

/** ₹800 phone number base for first purchase (₹700 rental + ₹100 setup before GST).
 *  NOTE: voice DIDs now use prefix-tiered pricing (phoneMonthlyBasePaise below);
 *  these flat constants remain in use for WhatsApp number purchases only. */
export const PHONE_BASE_PAISE = 80_000;

/** ₹700 phone number base for monthly renewals (telephony rental before GST) — WhatsApp only, see above */
export const PHONE_RENEWAL_BASE_PAISE = 70_000;

/** ₹100 one-time setup fee on first voice-number purchase (before GST) */
export const PHONE_SETUP_PAISE = 10_000;

/**
 * Prefix-tiered monthly rental for voice numbers (before GST):
 *   +91 80… series → ₹599/mo
 *   +91 79… series → ₹699/mo
 *   everything else → ₹659/mo
 * Accepts E.164 ("+9180…"), bare digits ("9180…"), or national ("080…") forms.
 */
export function phoneMonthlyBasePaise(number: string): number {
  const digits = String(number ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (digits.startsWith("9180")) return 59_900;
  if (digits.startsWith("9179")) return 69_900;
  return 65_900;
}

/** First-purchase base for a voice number: tiered monthly rental + one-time ₹100 setup (before GST) */
export function phonePurchaseBasePaise(number: string): number {
  return phoneMonthlyBasePaise(number) + PHONE_SETUP_PAISE;
}

/** Flat ₹5 / minute platform fee */
export const RATE_PAISE_PER_MIN = 500;

/** Minimum wallet top-up credit (₹100) — regular accounts */
export const MIN_TOPUP_PAISE = 10_000;

/** Minimum wallet top-up credit for active partner (reseller) owners (₹5,000) */
export const MIN_PARTNER_TOPUP_PAISE = 500_000;

/** Minimum top-up in paise for the given account type */
export function minTopupPaiseForUser(isPartner: boolean): number {
  return isPartner ? MIN_PARTNER_TOPUP_PAISE : MIN_TOPUP_PAISE;
}

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

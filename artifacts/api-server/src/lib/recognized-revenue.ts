/** Wallet rows that are voice or WhatsApp DID purchase / renewal fees. */
export function phoneFeeDebitRaw(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return `${p}type = 'debit' and (${p}description ilike '%phone%' or ${p}description ilike '%whatsapp number%')`;
}

/** Call usage + phone/WhatsApp number fees. */
export function recognizedRevenueRaw(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return `(${p}type = 'call_debit' or (${phoneFeeDebitRaw(alias)}))`;
}

/** Card/UPI DID fees — real Razorpay cash, wallet balance not reduced. */
export function cardPaidDidDebitRaw(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return `(${phoneFeeDebitRaw(alias)}) and (
    ${p}description ilike '%paid by card%'
    or (
      ${p}razorpay_payment_id is not null
      and ${p}razorpay_payment_id not like 'wallet%'
    )
  )`;
}

/** Phone/WhatsApp fees taken from the prepaid wallet. */
export function walletFundedPhoneDebitRaw(alias = ""): string {
  return `(${phoneFeeDebitRaw(alias)}) and not (${cardPaidDidDebitRaw(alias)})`;
}

/** GST-inclusive rupees charged on a pre-GST wallet top-up credit. */
export function topupGrossPaise(basePaise: number, gstRate = 0.18): number {
  return basePaise + Math.round(basePaise * gstRate);
}

/** Per-row GST-inclusive top-up amount (matches gstPortionPaise). */
export function topupGrossExpr(alias = ""): string {
  const col = alias ? `${alias}.amount_cents` : "amount_cents";
  return `(${col} + round((${col}) * 0.18))`;
}

export function successfulTopupRaw(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return `${p}type in ('topup','auto_topup') and lower(${p}status) in ('completed','success')`;
}

/** Ledger rows that represent rupees received (GST-inclusive topups + card DIDs). */
export function cashInEventRaw(alias = ""): string {
  return `(${successfulTopupRaw(alias)}) or (${cardPaidDidDebitRaw(alias)})`;
}

export const PHONE_FEE_DEBIT_RAW = phoneFeeDebitRaw();
export const RECOGNIZED_REVENUE_RAW = recognizedRevenueRaw();
export const CARD_PAID_DID_DEBIT_RAW = cardPaidDidDebitRaw();
export const WALLET_FUNDED_PHONE_DEBIT_RAW = walletFundedPhoneDebitRaw();
export const SUCCESSFUL_TOPUP_RAW = successfulTopupRaw();
export const CASH_IN_EVENT_RAW = cashInEventRaw();

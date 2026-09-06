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

/** Same population as Recharges “Real users only”. */
export function realCustomerTxnRaw(alias = ""): string {
  const col = alias ? `${alias}.user_id` : "user_id";
  return `${col} in (select id from users where coalesce(is_test, false) = false)`;
}

/** Ledger rows that represent rupees received (GST-inclusive topups + card DIDs). */
export function cashInEventRaw(alias = ""): string {
  return `(${successfulTopupRaw(alias)}) or (${cardPaidDidDebitRaw(alias)})`;
}

/** Credits that hit the wallet but are not Razorpay top-ups (signup ₹500, admin, partner). */
export function promoAdminCreditRaw(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return `${p}type in ('free_credit','admin_credit','partner_transfer_in','credit')
    and lower(${p}status) in ('completed','success')`;
}

/** Every completed inflow that increased a wallet balance. */
export function walletInflowRaw(alias = ""): string {
  return `(${successfulTopupRaw(alias)}) or (${promoAdminCreditRaw(alias)})`;
}

/** Non-revenue ledger movements used in the liability rollforward. */
export function ledgerAdjustmentRaw(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return `(
    ${p}type in ('refund','credit','admin_credit','admin_debit','partner_transfer_in','partner_transfer_out')
    or (${p}type = 'debit' and not (${phoneFeeDebitRaw(alias)}))
  )`;
}

export const PHONE_FEE_DEBIT_RAW = phoneFeeDebitRaw();
export const RECOGNIZED_REVENUE_RAW = recognizedRevenueRaw();
export const CARD_PAID_DID_DEBIT_RAW = cardPaidDidDebitRaw();
export const WALLET_FUNDED_PHONE_DEBIT_RAW = walletFundedPhoneDebitRaw();
export const SUCCESSFUL_TOPUP_RAW = successfulTopupRaw();
export const REAL_CUSTOMER_TXN_RAW = realCustomerTxnRaw();
export const CASH_IN_EVENT_RAW = cashInEventRaw();
export const PROMO_ADMIN_CREDIT_RAW = promoAdminCreditRaw();
export const WALLET_INFLOW_RAW = walletInflowRaw();
export const LEDGER_ADJUSTMENT_RAW = ledgerAdjustmentRaw();

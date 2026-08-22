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

export const PHONE_FEE_DEBIT_RAW = phoneFeeDebitRaw();
export const RECOGNIZED_REVENUE_RAW = recognizedRevenueRaw();

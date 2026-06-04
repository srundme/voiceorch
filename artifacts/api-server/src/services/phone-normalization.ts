/**
 * Phone Normalization Engine
 *
 * Converts any phone number string to E.164 format (+[country][number]).
 * All deduplication, DNC checks, and dialling use the normalized form.
 * The original raw input is preserved separately for display.
 *
 * Algorithm (applied in order):
 *  1. Strip formatting (spaces, dashes, dots, parens)
 *  2. If starts with + → validate, return as-is
 *  3. If starts with 00 → replace with +, validate
 *  4. If matches bare national length for workspace country → prepend +countryCode
 *  5. If starts with countryCode digits → prepend +
 *  6. Otherwise → return null (invalid)
 */

export interface NormalizationResult {
  normalized: string | null;
  raw: string;
  valid: boolean;
  reason?: string;
}

export interface WorkspacePhoneConfig {
  defaultCountryCode: string;   // e.g. "91", "1", "44"
  nationalDigitLength: number;  // e.g. 10 for India, 10 for USA
}

// Default workspace config (India) — overridden per workspace at call sites
export const INDIA_PHONE_CONFIG: WorkspacePhoneConfig = {
  defaultCountryCode: "91",
  nationalDigitLength: 10,
};

export const USA_PHONE_CONFIG: WorkspacePhoneConfig = {
  defaultCountryCode: "1",
  nationalDigitLength: 10,
};

/**
 * Normalize a single phone number to E.164.
 * Returns null in the normalized field if normalization fails.
 */
export function normalizePhone(
  raw: string,
  config: WorkspacePhoneConfig = INDIA_PHONE_CONFIG,
): NormalizationResult {
  if (!raw || typeof raw !== "string") {
    return { normalized: null, raw: raw ?? "", valid: false, reason: "empty_input" };
  }

  // Step 1 — strip formatting characters, keep leading +
  const hasLeadingPlus = raw.trimStart().startsWith("+");
  const stripped = raw.replace(/[\s\-().]/g, "").replace(/[^\d+]/g, "");
  const digitsOnly = stripped.replace(/\+/g, "");

  // Step 2 — already has +, validate
  if (hasLeadingPlus || stripped.startsWith("+")) {
    const e164 = "+" + digitsOnly;
    if (digitsOnly.length < 7 || digitsOnly.length > 15) {
      return { normalized: null, raw, valid: false, reason: "invalid_length" };
    }
    return { normalized: e164, raw, valid: true };
  }

  // Step 3 — starts with 00 (international dialing prefix)
  if (digitsOnly.startsWith("00")) {
    const withoutPrefix = digitsOnly.slice(2);
    if (withoutPrefix.length < 7 || withoutPrefix.length > 15) {
      return { normalized: null, raw, valid: false, reason: "invalid_length" };
    }
    return { normalized: "+" + withoutPrefix, raw, valid: true };
  }

  const { defaultCountryCode, nationalDigitLength } = config;

  // Step 4 — bare national number (exactly nationalDigitLength digits)
  if (digitsOnly.length === nationalDigitLength) {
    return { normalized: "+" + defaultCountryCode + digitsOnly, raw, valid: true };
  }

  // Step 5 — number starts with country code
  if (digitsOnly.startsWith(defaultCountryCode)) {
    const withoutCode = digitsOnly.slice(defaultCountryCode.length);
    if (withoutCode.length === nationalDigitLength) {
      return { normalized: "+" + digitsOnly, raw, valid: true };
    }
  }

  // Step 6 — starts with 0 (common local prefix in India: 09876543210)
  if (digitsOnly.startsWith("0") && digitsOnly.length === nationalDigitLength + 1) {
    const withoutZero = digitsOnly.slice(1);
    return { normalized: "+" + defaultCountryCode + withoutZero, raw, valid: true };
  }

  return { normalized: null, raw, valid: false, reason: "unrecognized_format" };
}

/**
 * Normalize a batch of phones. Returns an array in the same order as input.
 */
export function normalizePhoneBatch(
  phones: string[],
  config: WorkspacePhoneConfig = INDIA_PHONE_CONFIG,
): NormalizationResult[] {
  return phones.map((p) => normalizePhone(p, config));
}

/**
 * Quick helper — returns the normalized string or null.
 */
export function toE164(
  raw: string,
  config: WorkspacePhoneConfig = INDIA_PHONE_CONFIG,
): string | null {
  return normalizePhone(raw, config).normalized;
}

/**
 * Phone normalization utilities
 * ─────────────────────────────────────────────────────────────────────────────
 * Normalizes phone numbers to E.164 format (+<country><number>).
 * Defaults to India (+91) country code for 10-digit numbers without a prefix.
 */

const DIGITS_ONLY = /\D/g;

/**
 * Normalize a phone number string to E.164 format.
 * Handles common input forms:
 *   9876543210       → +919876543210  (assumes India)
 *   919876543210     → +919876543210
 *   +919876543210    → +919876543210
 *   +1 (555) 123-4567→ +15551234567
 *   0919876543210    → +919876543210
 */
export function normalizePhone(raw: string, defaultCountryCode = "91"): string {
  const trimmed = raw.trim();

  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(DIGITS_ONLY, "");
    return `+${digits}`;
  }

  let digits = trimmed.replace(DIGITS_ONLY, "");

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
    return `+${digits}`;
  }

  if (digits.startsWith("0") && digits.length > 10) {
    digits = digits.slice(1);
  }

  if (digits.length === 10) {
    return `+${defaultCountryCode}${digits}`;
  }

  if (digits.length > 10) {
    return `+${digits}`;
  }

  return `+${defaultCountryCode}${digits}`;
}

/**
 * Number sent to the carrier. Sheet and CSV cells are often 10 digits with no
 * country code — those become +91… India does not need +91 typed in the sheet.
 * An already-correct +91… value is left as-is.
 */
export function toDialNumber(
  stored: string | null | undefined,
  raw: string | null | undefined,
): string {
  const candidate = (stored?.trim() || raw?.trim() || "");
  if (!candidate) return "";
  return normalizePhone(candidate);
}

/**
 * Extract the first name from a full name string.
 * "John Abraham Doe" → "john"
 */
export function extractFirstName(fullName: string | null | undefined): string | null {
  if (!fullName?.trim()) return null;
  return fullName.trim().split(/\s+/)[0]!.toLowerCase();
}

/**
 * Clean a name string: trim, collapse whitespace, title-case.
 * "JOHN  DOE " → "John Doe"
 */
export function cleanName(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

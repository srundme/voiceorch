/**
 * caller-identity.ts — single source of truth for the caller-memory identity key.
 *
 * Caller memory (caller_profiles / caller_facts / caller_call_archive) is keyed on
 * (agent_id, phone_number). Both the READ path (loadCallerContext) and the WRITE
 * path (updateCallerProfile, archiveCall, supersedeFact, latch*) MUST derive that
 * key through `canonicalizeCallerKey` so they can never drift apart.
 *
 * Why this exists: the raw caller identity arrives in many shapes across calls —
 * E.164 with a leading `+` on one call but not the next, the national trunk `0`
 * present or absent, and inbound calls keying off the caller's number while
 * outbound/campaign calls key off our own stored number. Any of those differences
 * used to produce a different byte-for-byte key, so memory was stored but never
 * retrieved on the next call. Canonicalizing collapses the common variants to one
 * stable representation.
 *
 * The function is shared by the api-server (orchestration/callerMemory.ts) and the
 * maintenance backfill script (@workspace/scripts) precisely so the runtime key and
 * the migrated rows can never use different rules.
 *
 * Tuning (env, optional — sensible India-market defaults):
 *   CALLER_ID_DEFAULT_CC   default calling code used to expand bare national /
 *                          trunk-0 numbers to international form. Default "91".
 *   CALLER_ID_NATIONAL_LEN expected national-number length for that market,
 *                          used to disambiguate "already has CC" from "bare
 *                          national". Default 10.
 */

const DEFAULT_CALLING_CODE = (process.env["CALLER_ID_DEFAULT_CC"] ?? "91").replace(/\D/g, "");
const NATIONAL_NUMBER_LEN = (() => {
  const n = Number.parseInt(process.env["CALLER_ID_NATIONAL_LEN"] ?? "10", 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
})();

/** Synthetic identity prefix used for browser web-call sessions (stable per user id). */
const WEBCALL_KEY_PREFIX = "webcall:user_";
/** Raw web-call identity shape produced by the telephony layer (fromNumber). */
const WEBCALL_RAW_PREFIX = "webcall-user-";

/**
 * True when the string looks like a dialable phone number (optionally `+`-prefixed,
 * 7–15 digits) once spaces/punctuation are stripped. Used to distinguish a real
 * caller number from a synthetic web-call identity.
 */
export function isRealPhoneNumber(n: string): boolean {
  const digits = (n ?? "").replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * Canonicalize a real phone number to one stable key. Both read and write call
 * this, so the absolute correctness of the result matters less than determinism —
 * the same human's number in any common shape must map to the same string.
 *
 * Collapses: `+` / no-`+`, the `00` international prefix, national trunk leading
 * `0`, and (for the configured market) bare-national vs country-code-prefixed.
 */
function canonicalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const hadPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  // Explicit international forms (`+…` or `00…`) are trusted as-is — they already
  // carry the country code and cannot have a national trunk zero.
  if (!hadPlus && digits.startsWith("00")) {
    const intl = digits.slice(2);
    return intl || null;
  }
  if (hadPlus) return digits;

  // National / local format: drop the trunk leading zero(s).
  digits = digits.replace(/^0+/, "");
  if (!digits) return null;

  if (DEFAULT_CALLING_CODE) {
    // Already country-code + national (e.g. 919876543210) → leave it.
    if (
      digits.length === DEFAULT_CALLING_CODE.length + NATIONAL_NUMBER_LEN &&
      digits.startsWith(DEFAULT_CALLING_CODE)
    ) {
      return digits;
    }
    // Bare national number (e.g. 9876543210) → expand with the default code.
    if (digits.length === NATIONAL_NUMBER_LEN) {
      return DEFAULT_CALLING_CODE + digits;
    }
  }

  // Unknown shape (international caller without `+`, odd length, etc.) — return the
  // digits unchanged. Read and write both land here identically, so still stable.
  return digits;
}

/**
 * Map ANY caller identity to its canonical caller-memory key.
 *
 * - Synthetic web-call keys (`webcall:user_<id>`) pass through unchanged.
 * - Raw web-call identities (`webcall-user-<id>`, as supplied by the telephony
 *   layer) are normalized to the synthetic `webcall:user_<id>` form.
 * - Real phone numbers are canonicalized via {@link canonicalizePhone}.
 * - Anything empty / unrecognized returns null (no memory key).
 */
export function canonicalizeCallerKey(identity: string | null | undefined): string | null {
  const raw = (identity ?? "").trim();
  if (!raw) return null;

  if (raw.startsWith(WEBCALL_KEY_PREFIX)) {
    const id = raw.slice(WEBCALL_KEY_PREFIX.length).trim();
    return id ? `${WEBCALL_KEY_PREFIX}${id}` : null;
  }
  if (raw.startsWith(WEBCALL_RAW_PREFIX)) {
    const id = raw.slice(WEBCALL_RAW_PREFIX.length).trim();
    return id ? `${WEBCALL_KEY_PREFIX}${id}` : null;
  }

  if (isRealPhoneNumber(raw)) return canonicalizePhone(raw);

  // Not a phone number and not a known synthetic shape — nothing to key on.
  return null;
}

/**
 * Resolve the caller-memory key from a call's from/to numbers, regardless of call
 * direction. Inbound calls key off the caller's number (fromNumber); outbound /
 * campaign calls key off the dialed number (toNumber). Both are canonicalized so
 * the same human resolves to the same key in either direction.
 */
export function humanPhone(fromNumber: string, toNumber: string): string | null {
  const fromKey = canonicalizeCallerKey(fromNumber);
  if (fromKey && isRealPhoneNumber(fromNumber)) return fromKey;
  const toKey = canonicalizeCallerKey(toNumber);
  if (toKey && isRealPhoneNumber(toNumber)) return toKey;
  return null;
}

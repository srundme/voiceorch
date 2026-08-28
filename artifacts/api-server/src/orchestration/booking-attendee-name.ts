/**
 * Booking attendee names must be English/Latin for calendar titles and emails,
 * even when the voice call captured Hindi/Tamil/Marathi/etc. native script.
 */

import anyAscii from "any-ascii";

/** True when the string contains letters outside Basic Latin (A–Z). */
export function hasNonLatinLetters(value: string): boolean {
  for (const ch of value) {
    if (/\p{L}/u.test(ch) && !/[A-Za-z]/.test(ch)) return true;
  }
  return false;
}

function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function titleCaseWords(s: string): string {
  return collapseSpaces(s)
    .split(" ")
    .filter(Boolean)
    .map((w) => {
      if (w.length <= 1) return w.toUpperCase();
      // Keep all-caps tokens short (II, MD) as-is; otherwise Title Case.
      if (/^[A-Z]{2,4}$/.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Turn an email local-part into a rough English display name.
 * "kishorekumarr307" → "Kishorekumarr"; "john.doe" → "John Doe".
 */
export function displayNameFromEmailLocal(email?: string | null): string | null {
  if (!email) return null;
  const local = String(email).split("@")[0]?.trim() ?? "";
  if (!local) return null;
  // Drop trailing digits / plus-tags; keep letter runs.
  const cleaned = local
    .replace(/\+.*$/, "")
    .replace(/[0-9]+$/g, "")
    .replace(/[._+-]+/g, " ")
    .replace(/[^a-zA-Z\s]/g, " ");
  const named = collapseSpaces(cleaned);
  if (named.length < 2) return null;
  // Avoid generic mailbox locals.
  if (/^(info|admin|support|hello|contact|sales|noreply|no.?reply)$/i.test(named.replace(/\s+/g, ""))) {
    return null;
  }
  return titleCaseWords(named);
}

function romanizeToLatin(name: string): string {
  const ascii = anyAscii(name);
  // Keep letters, spaces, and common name punctuation only.
  return collapseSpaces(ascii.replace(/[^a-zA-Z\s.'-]/g, " "));
}

function looksWeakRomanization(romanized: string): boolean {
  if (romanized.length < 2) return true;
  const words = romanized.split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  if (words.length === 1 && words[0]!.length < 3) return true;
  // STT-mangled Indic often yields short clumps + stray letters ("ksor kmr h").
  if (words.length >= 2 && words.some((w) => w.length <= 1)) return true;
  if (words.length >= 2 && words.every((w) => w.length <= 3)) return true;
  return false;
}

/**
 * Normalize an attendee name for emails + calendar titles.
 * - Already Latin → title-case clean-up
 * - Native script (Hindi/Tamil/…) → ASCII romanization
 * - If romanization is weak and email local-part looks like a name → prefer email
 */
export function latinizeAttendeeName(
  name: string,
  email?: string | null,
): string {
  const raw = String(name ?? "").trim();
  const fromEmail = displayNameFromEmailLocal(email);

  if (!raw) return fromEmail || "Guest";

  if (!hasNonLatinLetters(raw)) {
    const latin = titleCaseWords(raw.replace(/[^a-zA-Z\s.'-]/g, " "));
    return latin || fromEmail || "Guest";
  }

  const romanized = titleCaseWords(romanizeToLatin(raw));
  if (romanized && !looksWeakRomanization(romanized)) {
    return romanized;
  }
  if (fromEmail) return fromEmail;
  return romanized || "Guest";
}

/**
 * Convert spoken digit words (English / Tamil / common STT transliterations)
 * into ASCII digits, then merge nearby fragments into Indian mobile numbers.
 *
 * Example (call 6062):
 *   "எயிட் நைன் ஜிரோ ஃபோர்" + "74887400" + "டபுள் ஜீரோ"
 *   → 8904 + 74887400 (+ optional 00) → 8904748874
 */

/** Longest-first so "double zero" wins over "zero". */
const SPOKEN_DIGIT_PATTERNS: Array<{ re: RegExp; digits: string }> = [
  // Multipliers
  { re: /\b(?:double|triple)\s*(?:zero|o|oh)\b/gi, digits: "00" },
  { re: /டபுள்\s*(?:ஜீரோ|ஜிரோ|பூஜ்ஜியம்)/gi, digits: "00" },
  { re: /ட்ரிப்பிள்\s*(?:ஜீரோ|ஜிரோ|பூஜ்ஜியம்)/gi, digits: "000" },
  { re: /\b(?:இரண்டு|ரெண்டு)\s*(?:ஜீரோ|ஜிரோ|பூஜ்ஜியம்)\b/gi, digits: "00" },

  // English digit words (avoid ambiguous: for/to/too/ate/o/oh)
  { re: /\bzero\b/gi, digits: "0" },
  { re: /\bone\b/gi, digits: "1" },
  { re: /\btwo\b/gi, digits: "2" },
  { re: /\bthree\b/gi, digits: "3" },
  { re: /\bfour\b/gi, digits: "4" },
  { re: /\bfive\b/gi, digits: "5" },
  { re: /\bsix\b/gi, digits: "6" },
  { re: /\bseven\b/gi, digits: "7" },
  { re: /\beight\b/gi, digits: "8" },
  { re: /\bnine\b/gi, digits: "9" },

  // Tamil script
  { re: /பூஜ்ஜியம்/gi, digits: "0" },
  { re: /(?:ஜீரோ|ஜிரோ)/gi, digits: "0" },
  { re: /ஒன்று/gi, digits: "1" },
  { re: /(?:இரண்டு|ரெண்டு)/gi, digits: "2" },
  { re: /மூன்று/gi, digits: "3" },
  { re: /நான்கு/gi, digits: "4" },
  { re: /ஐந்து/gi, digits: "5" },
  { re: /ஆறு/gi, digits: "6" },
  { re: /ஏழு/gi, digits: "7" },
  { re: /எட்டு/gi, digits: "8" },
  { re: /ஒன்பது/gi, digits: "9" },

  // Common STT / Tanglish transliterations
  { re: /\b(?:jiro|jeero|jero)\b/gi, digits: "0" },
  { re: /\b(?:onnu|ondru)\b/gi, digits: "1" },
  { re: /\b(?:rendu|randu)\b/gi, digits: "2" },
  { re: /\b(?:moonu|moonru)\b/gi, digits: "3" },
  { re: /\b(?:naalu|naal|nangu|foar|phor)\b/gi, digits: "4" },
  { re: /ஃபோர்/gi, digits: "4" },
  { re: /\b(?:anj|aindhu|ainthu)\b/gi, digits: "5" },
  { re: /\b(?:aaru)\b/gi, digits: "6" },
  { re: /\b(?:yezhu|ezhu)\b/gi, digits: "7" },
  { re: /\b(?:ettu|yeight)\b/gi, digits: "8" },
  { re: /எயிட்/gi, digits: "8" },
  { re: /\b(?:onbadhu|ombadhu)\b/gi, digits: "9" },
  { re: /நைன்/gi, digits: "9" },
];

/**
 * Replace spoken digit words with ASCII digits. Leaves other text intact.
 * Adjacent replacements are joined without extra separators so
 * "eight nine zero four" → "8904".
 */
export function expandSpokenDigits(text: string): string {
  if (!text) return text;
  let out = text.replace(/<\/?spell>/gi, " ");

  // Apply patterns; after each replacement, collapse "digit + spaces + digit"
  // runs that came from spoken words so fragments glue naturally.
  for (const { re, digits } of SPOKEN_DIGIT_PATTERNS) {
    out = out.replace(re, ` ${digits} `);
  }

  // Glue digit tokens that are only separated by whitespace/punctuation
  // when they look like a spoken-digit stream (short chunks).
  out = out.replace(/(\d)(?:[\s,./|]+(\d))+/g, (match) => match.replace(/\D/g, ""));

  return out.replace(/[^\S\n]+/g, " ").trim();
}

function isIndianMobile10(d: string): boolean {
  return /^[6-9]\d{9}$/.test(d);
}

export function scorePhoneCandidate(d: string): number {
  if (isIndianMobile10(d)) return 100;
  if (/^91[6-9]\d{9}$/.test(d)) return 90;
  if (d.length >= 10 && d.length <= 12 && /^[6-9]/.test(d)) return 70;
  if (d.length >= 8 && d.length <= 15) return 40;
  return 0;
}

/** Pick the best-looking phone from a candidate list. */
export function pickBestPhone(phones: string[]): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const p of phones) {
    const s = scorePhoneCandidate(p);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return bestScore >= 40 ? best : (phones[phones.length - 1] ?? null);
}

/** Prefer best Indian-looking phone from a concatenated digit string. */
export function preferIndianPhone(digits: string): string | null {
  const d = digits.replace(/\D/g, "");
  if (!d) return null;
  const candidates: string[] = [d];
  if (d.length > 10) {
    candidates.push(d.slice(0, 10));
    candidates.push(d.slice(-10));
  }
  if (d.length >= 12 && d.startsWith("91")) {
    candidates.push(d.slice(0, 12));
  }
  let best: string | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    if (c.length < 8 || c.length > 15) continue;
    const s = scorePhoneCandidate(c);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return bestScore >= 40 ? best : null;
}

type DigitRun = { start: number; end: number; digits: string };

function findDigitRuns(text: string): DigitRun[] {
  const runs: DigitRun[] = [];
  for (const m of text.matchAll(/\d{2,15}/g)) {
    if (m.index == null) continue;
    runs.push({ start: m.index, end: m.index + m[0]!.length, digits: m[0]! });
  }
  return runs;
}

/**
 * Merge nearby digit fragments (from spoken words + typed digits) into
 * phone candidates. Fragments within `maxGap` chars are concatenated in order.
 */
export function mergeSpokenPhoneFragments(
  transcript: string,
  maxGap = 280,
): string[] {
  const expanded = expandSpokenDigits(transcript);
  const runs = findDigitRuns(expanded);
  if (!runs.length) return [];

  const phones: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const phone = preferIndianPhone(raw);
    if (!phone) return;
    const key = phone.length > 10 ? phone.slice(-10) : phone;
    if (seen.has(key)) return;
    seen.add(key);
    phones.push(phone);
  };

  // Also keep standalone long runs.
  for (const r of runs) {
    if (r.digits.length >= 8) push(r.digits);
  }

  // Sliding concat of consecutive nearby runs.
  // Skip agent echoes ("8904" repeated) and trailing fragments already
  // contained in the concat ("74887400" + "00").
  for (let i = 0; i < runs.length; i++) {
    let concat = runs[i]!.digits;
    let end = runs[i]!.end;
    let lastFrag = runs[i]!.digits;
    push(concat);
    for (let j = i + 1; j < runs.length; j++) {
      const next = runs[j]!;
      if (next.start - end > maxGap) break;
      end = next.end;
      if (next.digits === lastFrag) continue;
      if (concat.endsWith(next.digits)) continue;
      concat += next.digits;
      lastFrag = next.digits;
      push(concat);
      if (concat.length >= 15) break;
    }
  }

  return phones;
}

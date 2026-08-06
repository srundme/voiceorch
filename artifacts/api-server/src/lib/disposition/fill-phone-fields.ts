/**
 * Fill missing phone/WhatsApp domain fields from transcript + called number
 * when the disposition LLM leaves them null.
 */

import type { DispositionConfig, DispositionResult } from "./types.js";
import { extractBarePhone, isPhoneLikeDispositionField } from "./normalize-fields.js";

const WHATSAPP_NEAR_RE =
  /whats?\s*app|wa\s*(?:number|no\.?)|வேற\s*n(?:umber|ம்)|வேற\s*number|alternate|அந்த\s*(?:whatsapp\s*)?number|same\s*number|இதே\s*number/i;

function normalizeDigits(n: string): string {
  return n.replace(/\D/g, "").replace(/^0+/, "");
}

function digitsEqual(a: string, b: string): boolean {
  const da = normalizeDigits(a);
  const db = normalizeDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  // Match 10-digit local vs 91XXXXXXXXXX
  const tail = (s: string) => (s.length > 10 ? s.slice(-10) : s);
  return tail(da) === tail(db);
}

/** All phone-like digit runs in transcript order. */
export function findPhonesInTranscript(transcript: string): string[] {
  const matches = [...transcript.matchAll(/(?:\+?\d[\d\s\-().]{6,18}\d)/g)].map((m) =>
    m[0]!.replace(/[\s\-().]/g, "").replace(/^\+/, ""),
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const d of matches) {
    if (d.length < 8 || d.length > 15) continue;
    const key = d.length > 10 ? d.slice(-10) : d;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

function preferWhatsappContextPhone(transcript: string, phones: string[]): string | null {
  if (!phones.length) return null;
  const lower = transcript.toLowerCase();
  for (const phone of phones) {
    const idx = lower.indexOf(phone.slice(-10).toLowerCase());
    const searchIdx = idx >= 0 ? idx : lower.search(new RegExp(phone.split("").join("\\s*")));
    if (searchIdx < 0) continue;
    const window = transcript.slice(Math.max(0, searchIdx - 80), searchIdx + phone.length + 80);
    if (WHATSAPP_NEAR_RE.test(window)) return phone;
  }
  // Last spoken number is usually the one being confirmed.
  return phones[phones.length - 1] ?? null;
}

function isSameNumberOutcome(sub: string): boolean {
  return /same\s*(number|num)|இதே|calling\s*number|this\s*number/i.test(sub);
}

function isAlternateNumberOutcome(sub: string): boolean {
  return /alternate|different|வேற|other\s*number|another\s*number/i.test(sub);
}

/**
 * Mutates/returns result with phone domain fields filled when missing.
 */
export function fillMissingPhoneFields(
  cfg: DispositionConfig,
  result: DispositionResult,
  transcript: string | null | undefined,
  calledNumber?: string | null,
): DispositionResult {
  const phoneFields = cfg.domainFields.filter((f) =>
    isPhoneLikeDispositionField(f.key, f.label, f.type),
  );
  if (!phoneFields.length) return result;

  const domain = { ...(result.domainFields ?? {}) };
  let changed = false;
  const phones = transcript?.trim() ? findPhonesInTranscript(transcript) : [];
  const called = calledNumber ? extractBarePhone(calledNumber) : null;

  for (const field of phoneFields) {
    const existing = domain[field.key];
    if (existing != null && existing !== "") continue;

    let filled: string | null = null;

    if (called && isSameNumberOutcome(result.sub)) {
      filled = called;
    } else if (phones.length) {
      const fromTx = preferWhatsappContextPhone(transcript ?? "", phones);
      if (fromTx) {
        // Prefer a number that isn't the dialed line when outcome is alternate.
        if (called && isAlternateNumberOutcome(result.sub)) {
          const alt = phones.find((p) => !digitsEqual(p, called)) ?? fromTx;
          filled = digitsEqual(alt, called) ? null : alt;
        } else if (called && digitsEqual(fromTx, called) && !isSameNumberOutcome(result.sub)) {
          // Number in transcript is just the dialed line — only keep if same-number.
          filled = null;
        } else {
          filled = fromTx;
        }
      }
    } else if (called && isSameNumberOutcome(result.sub)) {
      filled = called;
    }

    if (filled) {
      domain[field.key] = filled;
      changed = true;
    }
  }

  if (!changed) return result;
  return { ...result, domainFields: domain };
}

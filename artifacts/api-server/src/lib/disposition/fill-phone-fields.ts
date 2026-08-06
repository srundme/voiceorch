/**
 * Fill missing phone/WhatsApp domain fields from transcript + called number
 * when the disposition LLM leaves them null.
 */

import type { DispositionConfig, DispositionResult } from "./types.js";
import { extractBarePhone, isPhoneLikeDispositionField } from "./normalize-fields.js";
import {
  expandSpokenDigits,
  mergeSpokenPhoneFragments,
  pickBestPhone,
} from "./spoken-digits.js";

const WHATSAPP_NEAR_RE =
  /whats?\s*app|wa\s*(?:number|no\.?)|வாட்ஸ்அப்|வேற\s*n(?:umber|ம்)|வேற\s*number|alternate|அந்த\s*(?:whatsapp\s*)?number|same\s*number|இதே\s*number|சரியான\s*(?:whatsapp\s*)?நம்பர்/i;

function normalizeDigits(n: string): string {
  return n.replace(/\D/g, "").replace(/^0+/, "");
}

function digitsEqual(a: string, b: string): boolean {
  const da = normalizeDigits(a);
  const db = normalizeDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  const tail = (s: string) => (s.length > 10 ? s.slice(-10) : s);
  return tail(da) === tail(db);
}

/** All phone-like digit runs in transcript order (incl. spoken digit words). */
export function findPhonesInTranscript(transcript: string): string[] {
  const fromSpoken = mergeSpokenPhoneFragments(transcript);
  // Strip TTS spell tags so <spell>683653279</spell> still matches.
  const cleaned = expandSpokenDigits(transcript);
  const matches = [...cleaned.matchAll(/(?:\+?\d[\d\s\-().]{6,22}\d)/g)].map((m) =>
    m[0]!.replace(/[\s\-().]/g, "").replace(/^\+/, ""),
  );
  const spaced = [...cleaned.matchAll(/(?:\b\d(?:\s+\d){7,14}\b)/g)].map((m) =>
    m[0]!.replace(/\s+/g, ""),
  );

  const out: string[] = [];
  const seen = new Set<string>();
  for (const d of [...fromSpoken, ...matches, ...spaced]) {
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
  const expanded = expandSpokenDigits(transcript);
  // Merged phones (spoken words + digit runs) often do not appear as one
  // contiguous string — if the call discussed WhatsApp / alternate number,
  // score the full candidate list instead of requiring an exact substring hit.
  if (WHATSAPP_NEAR_RE.test(expanded) || /வேற\s*நம்பர்|alternate/i.test(expanded)) {
    return pickBestPhone(phones);
  }
  const lower = expanded.toLowerCase();
  const near: string[] = [];
  for (const phone of phones) {
    const needle = phone.slice(-10);
    const idx = lower.indexOf(needle.toLowerCase());
    if (idx < 0) continue;
    const window = expanded.slice(Math.max(0, idx - 160), idx + Math.max(phone.length, 10) + 160);
    if (WHATSAPP_NEAR_RE.test(window)) near.push(phone);
  }
  return pickBestPhone(near.length ? near : phones);
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
      const notCalled = called ? phones.filter((p) => !digitsEqual(p, called)) : phones;
      if (notCalled.length) {
        filled = preferWhatsappContextPhone(transcript ?? "", notCalled) ?? notCalled[notCalled.length - 1]!;
      } else if (isSameNumberOutcome(result.sub) || /same|இதே|this\s*number|calling\s*number/i.test(transcript ?? "")) {
        filled = called ?? phones[phones.length - 1]!;
      } else if (isAlternateNumberOutcome(result.sub)) {
        filled = null;
      } else {
        filled = preferWhatsappContextPhone(transcript ?? "", phones);
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

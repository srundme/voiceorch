import type { SheetUseCase } from "@workspace/db";

/** SnapServe field → sheet header defaults when binding.columnMap is empty. */
export const DEFAULT_COLUMN_MAPS: Record<"call_log" | "outcome" | "lookup", Record<string, string>> = {
  call_log: {
    callId: "Call ID",
    startedAt: "Started At (IST)",
    durationSeconds: "Duration (sec)",
    direction: "Direction",
    phone: "Phone",
    callerName: "Caller Name",
    disposition: "Disposition",
    summary: "Summary",
    recordingUrl: "Recording",
    agentName: "Agent",
    costCents: "Cost (₹)",
  },
  outcome: {
    phone: "Phone",
    name: "Name",
    email: "Email",
    status: "Status",
    lastCallAt: "Last Call At",
    disposition: "Disposition",
    notes: "Notes",
    nextFollowUp: "Next Follow-up",
  },
  lookup: {
    phone: "Phone",
    name: "Name",
    email: "Email",
    status: "Status",
    notes: "Notes",
  },
};

export function defaultColumnMapForUseCase(useCase: SheetUseCase): Record<string, string> {
  if (useCase === "call_log") return { ...DEFAULT_COLUMN_MAPS.call_log };
  if (useCase === "outcome" || useCase === "lookup") return { ...DEFAULT_COLUMN_MAPS.outcome };
  return {};
}

/** Prefer last 10 for IN mobiles; strip trunk 0 / 91 before compare. */
export function normalizePhoneDigits(digits: string): string {
  let d = digits.replace(/\D/g, "");
  if (d.startsWith("0") && d.length === 11) d = d.slice(1);
  if (d.startsWith("91") && d.length === 12) d = d.slice(2);
  return d;
}

/** Digits-only phone compare; also matches on last 10 digits (India mobile). */
export function phonesMatch(a: string, b: string): boolean {
  const da = a.replace(/\D/g, "");
  const db = b.replace(/\D/g, "");
  if (!da || !db) return false;
  if (da === db) return true;
  const na = normalizePhoneDigits(da);
  const nb = normalizePhoneDigits(db);
  if (na === nb) return true;
  const la = na.slice(-10);
  const lb = nb.slice(-10);
  return la.length === 10 && lb.length === 10 && la === lb;
}

/**
 * Pull every plausible phone from a messy cell.
 * Handles: "9876543210 / 9123456780", "98765-43210, 91234 56780", "+91 9876543210"
 */
export function extractPhoneCandidates(raw: string): string[] {
  if (!raw?.trim()) return [];
  const out: string[] = [];
  const push = (digits: string) => {
    const d = digits.replace(/\D/g, "");
    if (d.length >= 8 && d.length <= 15) out.push(d);
  };

  for (const part of raw.split(/[/|,;\\]+|(?:\s+and\s+)|(?:\s+or\s+)|(?:\n+)/i)) {
    push(part);
  }
  const spans = raw.match(/(?:\+?\d[\d\s\-().]{6,18}\d)/g) ?? [];
  for (const span of spans) push(span);

  return [...new Set(out)];
}

/** True if the cell (possibly with 2+ numbers) matches the call phone. */
export function cellMatchesPhone(cell: string, phone: string): boolean {
  if (!cell?.trim() || !phone?.trim()) return false;
  const candidates = extractPhoneCandidates(cell);
  if (candidates.length === 0) return phonesMatch(cell, phone);
  return candidates.some((c) => phonesMatch(c, phone));
}

export function slugifyHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

const NAME_HEADER_RE = /^(full[_\s-]?)?name$|customer[_\s-]?name|caller[_\s-]?name|contact[_\s-]?name|person|client[_\s-]?name/i;
const PHONE_HEADER_RE = /phone|mobile|whatsapp|contact[_\s-]?(no|number|#)|cell|tel/i;
const EMAIL_HEADER_RE = /e-?mail|email\s*id/i;

/** Cap very long sheet cells so prompts stay bounded (names can still be long). */
const MAX_VAR_CHARS = 500;

/**
 * Turn a sheet row into prompt variables:
 *   Name → {{name}}, {{customer_name}}, {{caller_name}}
 *   Phone Number → {{phone}}, {{customer_phone}}
 *   City → {{city}}
 *   plus every header as a slug.
 */
export function rowToPromptVars(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const set = (key: string, value: string) => {
    if (!key || !value) return;
    if (key in out) return;
    out[key] = value.length > MAX_VAR_CHARS ? value.slice(0, MAX_VAR_CHARS) : value;
  };

  for (const [header, raw] of Object.entries(values)) {
    const value = raw?.trim();
    if (!value) continue;
    const slug = slugifyHeader(header);
    set(slug, value);
    if (/^\w+$/.test(header) && header !== slug) set(header, value);

    if (NAME_HEADER_RE.test(header) || slug === "name") {
      set("name", value);
      set("customer_name", value);
      set("caller_name", value);
    }
    if (PHONE_HEADER_RE.test(header) || slug === "phone" || slug === "mobile") {
      set("phone", value);
      set("customer_phone", value);
      set("mobile", value);
    }
    if (EMAIL_HEADER_RE.test(header) || slug === "email") {
      set("email", value);
      set("customer_email", value);
    }
  }
  return out;
}

/** Find phone-like column index; prefers exact matchColumn, then fuzzy phone headers. */
export function resolveMatchColumnIndex(headers: string[], matchColumn: string): number {
  const want = matchColumn.trim().toLowerCase();
  if (want) {
    const exact = headers.findIndex((h) => h.toLowerCase() === want);
    if (exact >= 0) return exact;
    const fuzzy = headers.findIndex((h) => {
      const hl = h.toLowerCase();
      return hl.includes(want) || want.includes(hl);
    });
    if (fuzzy >= 0) return fuzzy;
  }
  return headers.findIndex((h) => PHONE_HEADER_RE.test(h));
}

export function escapeSheetName(name: string): string {
  if (/['\s!]/.test(name)) {
    return `'${name.replace(/'/g, "''")}'`;
  }
  return name;
}

export function sheetRange(sheetName: string, a1: string): string {
  return `${escapeSheetName(sheetName)}!${a1}`;
}

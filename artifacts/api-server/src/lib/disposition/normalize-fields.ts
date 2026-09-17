/**
 * Post-process disposition field values so phone/WhatsApp fields stay as
 * bare numbers (not "The caller shared WhatsApp as 98…") and free-text
 * fields stay short scalars instead of summary paragraphs.
 */

import { expandSpokenDigits } from "./spoken-digits.js";

const PHONE_KEY_RE =
  /whats?\s*app|wa[_\s-]?number|mobile|phone|cell|contact[_\s-]?number|alternate|alternative|msisdn|^tel$/i;

export function isPhoneLikeDispositionField(
  key: string,
  label?: string,
  type?: string,
): boolean {
  if (type === "number" && PHONE_KEY_RE.test(key)) return true;
  return PHONE_KEY_RE.test(key) || (!!label && PHONE_KEY_RE.test(label));
}

/**
 * Pull a phone-like token out of prose. Prefer the longest 10–15 digit run
 * (Indian mobile / E.164 without +). Returns null when nothing usable.
 */
function pickPhoneCandidate(raw: string): string | null {
  const compact = raw.replace(/[\s\-().]/g, "");
  if (/^\+?\d{8,15}$/.test(compact)) {
    return compact.startsWith("+") ? compact.slice(1) : compact;
  }
  const matches = [...raw.matchAll(/(?:\+?\d[\d\s\-().]{7,18}\d)/g)].map((m) =>
    m[0]!.replace(/[\s\-().]/g, "").replace(/^\+/, ""),
  );
  const candidates = matches.filter((d) => d.length >= 8 && d.length <= 15);
  if (!candidates.length) return null;
  const ten = candidates.find((d) => d.length === 10 || (d.length === 12 && d.startsWith("91")));
  return ten ?? candidates.sort((a, b) => b.length - a.length)[0]!;
}

export function extractBarePhone(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const digits = String(Math.trunc(value));
    return digits.length >= 8 && digits.length <= 15 ? digits : null;
  }
  const raw = String(value).trim();
  if (!raw || raw.toLowerCase() === "null" || raw.toLowerCase() === "n/a") return null;

  // Already digits, or prose with digit runs.
  const direct = pickPhoneCandidate(raw);
  if (direct) return direct;

  // Spoken / STT: "eight nine zero four…" / Tamil digit words → ASCII, then re-scan.
  const expanded = expandSpokenDigits(raw);
  if (expanded !== raw) {
    const fromSpoken = pickPhoneCandidate(expanded);
    if (fromSpoken) return fromSpoken;
  }
  return null;
}

export type DispositionSchemaField = {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
};

/** Clamp a free-text disposition value so it cannot become a summary paragraph. */
export function clampDispositionText(value: unknown, maxChars = 120): string | null {
  if (value == null) return null;
  let s = String(value).trim();
  if (!s || s.toLowerCase() === "null") return null;
  // Drop obvious multi-sentence dumps into a scalar field.
  const firstSentence = s.split(/(?<=[.!?])\s+/)[0] ?? s;
  if (firstSentence.length < s.length && firstSentence.length >= 3) s = firstSentence;
  if (s.length > maxChars) s = s.slice(0, maxChars).trim();
  return s || null;
}

/**
 * Normalize a flat dispositionSchema extraction result in place.
 * Phone-like keys → digits only; other text → short scalar / null.
 */
export function normalizeDispositionSchemaResult(
  schema: DispositionSchemaField[],
  result: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...result };
  for (const field of schema) {
    if (!(field.key in out)) continue;
    const raw = out[field.key];
    if (raw == null) {
      delete out[field.key];
      continue;
    }
    if (field.type === "boolean") {
      if (typeof raw === "boolean") continue;
      const s = String(raw).trim().toLowerCase();
      if (s === "true" || s === "yes" || s === "y") out[field.key] = true;
      else if (s === "false" || s === "no" || s === "n") out[field.key] = false;
      else delete out[field.key];
      continue;
    }
    if (field.type === "number" && !isPhoneLikeDispositionField(field.key, field.label, field.type)) {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
      if (Number.isFinite(n)) out[field.key] = n;
      else delete out[field.key];
      continue;
    }
    if (isPhoneLikeDispositionField(field.key, field.label, field.type)) {
      const phone = extractBarePhone(raw);
      if (phone) out[field.key] = phone;
      else delete out[field.key];
      continue;
    }
    if (field.type === "choice" && field.options?.length) {
      const s = String(raw).trim();
      const hit = field.options.find((o) => o.toLowerCase() === s.toLowerCase());
      if (hit) out[field.key] = hit;
      else delete out[field.key];
      continue;
    }
    // text / string — never allow a paragraph dump into a scalar field
    const clamped = clampDispositionText(raw);
    if (clamped) out[field.key] = clamped;
    else delete out[field.key];
  }
  return out;
}

/** Field-list lines for the extraction prompt (type-aware hints). */
export function formatDispositionFieldList(schema: DispositionSchemaField[]): string {
  return schema
    .map((f) => {
      const phone = isPhoneLikeDispositionField(f.key, f.label, f.type);
      const typeHint = phone
        ? "phone — digits only, no words, e.g. 9876543210 or 919876543210; null if not collected"
        : f.type === "boolean"
          ? "boolean true/false"
          : f.type === "number"
            ? "number"
            : f.type === "choice" && f.options?.length
              ? `choice — only one of: [${f.options.join(", ")}]`
              : "short text — a few words or a single value, NEVER a sentence or paragraph";
      return `- "${f.key}" (${f.label}): ${typeHint}`;
    })
    .join("\n");
}

export const DISPOSITION_EXTRACT_SYSTEM =
  "You extract structured disposition fields from call transcripts. " +
  "Return ONLY a flat JSON object with the specified keys — no markdown, no commentary. " +
  "CRITICAL: each field value must be a bare scalar (number, boolean, short enum, or short phrase). " +
  "Never put a summary sentence or paragraph into a field. " +
  "For phone / WhatsApp / mobile fields: return digits only (optional leading country code), never prose like \"the caller said their WhatsApp is…\". " +
  "If a field was not clearly collected, use null.";

/** JSON Schema for DispositionLLM.extract — keys match agents.dispositionSchema. */
export function jsonSchemaFromDispositionFields(
  schema: DispositionSchemaField[],
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const f of schema) {
    const phone = isPhoneLikeDispositionField(f.key, f.label, f.type);
    if (f.type === "boolean") {
      properties[f.key] = { type: ["boolean", "null"], description: f.label };
    } else if (f.type === "number" && !phone) {
      properties[f.key] = { type: ["number", "null"], description: f.label };
    } else if (f.type === "choice" && f.options?.length) {
      properties[f.key] = {
        type: ["string", "null"],
        enum: [...f.options, null],
        description: f.label,
      };
    } else {
      properties[f.key] = {
        type: ["string", "null"],
        description: phone ? `${f.label} (digits only)` : f.label,
      };
    }
  }
  return {
    type: "object",
    properties,
    additionalProperties: false,
  };
}

/** True when any configured schema key is still empty on the stored result. */
export function schemaFieldsNeedFill(
  existing: Record<string, unknown> | null | undefined,
  schema: DispositionSchemaField[],
): boolean {
  if (!schema.length) return false;
  if (!existing || typeof existing !== "object") return true;
  return schema.some((f) => {
    const v = existing[f.key];
    return v == null || v === "";
  });
}

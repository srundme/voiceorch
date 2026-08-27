/**
 * Durable caller facts — closed schema + normalizers + validation gate.
 *
 * Ephemeral sales state belongs in the call summary / episode, NOT in
 * caller_facts. Only verified, schema-constrained identity facts persist.
 */

import { sanitizeSpokenEmailAddress } from "./endpointing.js";

/** Closed enum — LLM / regex may only fill these keys. */
export const DURABLE_FACT_KEYS = [
  "name",
  "age",
  "gender",
  "location",
  "family_spouse_name",
  "family_children_count",
  "occupation",
  "company_name",
  "email",
  "language_pref",
  "preferred_contact_method",
] as const;

export type DurableFactKey = (typeof DURABLE_FACT_KEYS)[number];

const DURABLE_SET = new Set<string>(DURABLE_FACT_KEYS);

/** Minimum confidence to persist after validation (design §4). */
export const MIN_FACT_CONFIDENCE = 0.6;

/** Direct restatement threshold — always wins over an older fact (design §5). */
export const HIGH_CONFIDENCE_OVERRIDE = 0.8;

/** Synonyms → canonical durable key. Unknown keys are dropped. */
const FACT_KEY_SYNONYMS: Record<string, DurableFactKey> = {
  name: "name",
  full_name: "name",
  caller_name: "name",
  customer_name: "name",
  first_name: "name",
  person_name: "name",

  age: "age",
  years_old: "age",
  caller_age: "age",

  gender: "gender",
  sex: "gender",

  location: "location",
  city: "location",
  area: "location",
  place: "location",
  lives_in: "location",
  living_in: "location",
  hometown: "location",
  home_town: "location",
  native_place: "location",
  native: "location",
  belongs_to: "location",
  based_in: "location",
  from: "location",
  residence: "location",
  address_city: "location",

  family_spouse_name: "family_spouse_name",
  spouse_name: "family_spouse_name",
  husband_name: "family_spouse_name",
  wife_name: "family_spouse_name",
  spouse: "family_spouse_name",

  family_children_count: "family_children_count",
  children_count: "family_children_count",
  kids: "family_children_count",
  kids_count: "family_children_count",
  number_of_children: "family_children_count",
  number_of_kids: "family_children_count",
  num_children: "family_children_count",
  // Legacy soft-keys map onto children count when numeric; otherwise dropped at normalize.
  family_size: "family_children_count",

  occupation: "occupation",
  job: "occupation",
  profession: "occupation",
  work: "occupation",
  works_as: "occupation",

  company_name: "company_name",
  employer: "company_name",
  company: "company_name",
  workplace: "company_name",
  organization: "company_name",

  email: "email",
  email_address: "email",
  e_mail: "email",

  language_pref: "language_pref",
  language: "language_pref",
  preferred_language: "language_pref",
  spoken_language: "language_pref",
  lang: "language_pref",

  preferred_contact_method: "preferred_contact_method",
  contact_method: "preferred_contact_method",
  preferred_channel: "preferred_contact_method",
};

/** Indian city aliases → canonical (extend as needed). */
const CITY_ALIASES: Record<string, string> = {
  bangalore: "Bengaluru",
  bengaluru: "Bengaluru",
  blr: "Bengaluru",
  bombay: "Mumbai",
  mumbai: "Mumbai",
  bom: "Mumbai",
  madras: "Chennai",
  chennai: "Chennai",
  maa: "Chennai",
  calcutta: "Kolkata",
  kolkata: "Kolkata",
  ccu: "Kolkata",
  delhi: "Delhi",
  "new delhi": "Delhi",
  ncr: "Delhi",
  hyderabad: "Hyderabad",
  hyd: "Hyderabad",
  pune: "Pune",
  poona: "Pune",
  gurgaon: "Gurugram",
  gurugram: "Gurugram",
  noida: "Noida",
  ahmedabad: "Ahmedabad",
  amdavad: "Ahmedabad",
  cochin: "Kochi",
  kochi: "Kochi",
  trivandrum: "Thiruvananthapuram",
  thiruvananthapuram: "Thiruvananthapuram",
};

const LANG_ALIASES: Record<string, string> = {
  hindi: "hi",
  hi: "hi",
  hin: "hi",
  english: "en",
  en: "en",
  eng: "en",
  tamil: "ta",
  ta: "ta",
  tam: "ta",
  telugu: "te",
  te: "te",
  tel: "te",
  kannada: "kn",
  kn: "kn",
  kan: "kn",
  malayalam: "ml",
  ml: "ml",
  mal: "ml",
  marathi: "mr",
  mr: "mr",
  mar: "mr",
  bengali: "bn",
  bangla: "bn",
  bn: "bn",
  gujarati: "gu",
  gu: "gu",
  punjabi: "pa",
  pa: "pa",
};

const CONTACT_ALIASES: Record<string, string> = {
  call: "call",
  phone: "call",
  phone_call: "call",
  sms: "sms",
  text: "sms",
  whatsapp: "whatsapp",
  wa: "whatsapp",
  email: "email",
};

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const HONORIFIC_RE = /^(mr|mrs|ms|miss|dr|prof|sir|madam|shri|smt)\.?\s+/i;

export function isDurableFactKey(key: string): key is DurableFactKey {
  return DURABLE_SET.has(key);
}

/** Normalize raw key string → canonical durable key, or null if not durable. */
export function canonicalizeFactKey(rawKey: string): DurableFactKey | null {
  const norm = rawKey
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 64);
  if (!norm) return null;
  if (DURABLE_SET.has(norm)) return norm as DurableFactKey;
  return FACT_KEY_SYNONYMS[norm] ?? null;
}

function titleCaseName(raw: string): string {
  return raw
    .replace(HONORIFIC_RE, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
    .slice(0, 80);
}

function normalizeLocation(raw: string): string | null {
  const trimmed = raw.trim().replace(/\.+$/, "");
  if (!trimmed || trimmed.length < 2 || trimmed.length > 60) return null;
  const key = trimmed.toLowerCase();
  if (CITY_ALIASES[key]) return CITY_ALIASES[key]!;
  // Title-case unknown cities
  return trimmed
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function normalizeLanguage(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return LANG_ALIASES[key] ?? (key.length === 2 ? key : null);
}

function normalizeContactMethod(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return CONTACT_ALIASES[key] ?? null;
}

function normalizeAge(raw: string): string | null {
  const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n) || n < 1 || n > 120) return null;
  return String(n);
}

function normalizeGender(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (["male", "m", "man", "boy"].includes(v)) return "male";
  if (["female", "f", "woman", "girl"].includes(v)) return "female";
  if (["other", "nonbinary", "non-binary"].includes(v)) return "other";
  return null;
}

function normalizeChildrenCount(raw: string): string | null {
  const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n) || n < 0 || n > 20) return null;
  return String(n);
}

/** Per-key value normalizer. Returns null if the value is invalid for that key. */
export function normalizeFactValue(key: DurableFactKey, raw: string): string | null {
  const value = String(raw ?? "").trim().slice(0, 512);
  if (!value) return null;

  switch (key) {
    case "name": {
      if (/\b(plan|policy|package|premium|coverage|budget)\b/i.test(value)) return null;
      const name = titleCaseName(value);
      if (name.length < 2 || name.split(/\s+/).length > 5) return null;
      return name;
    }
    case "age":
      return normalizeAge(value);
    case "gender":
      return normalizeGender(value);
    case "location":
      return normalizeLocation(value);
    case "family_spouse_name": {
      const name = titleCaseName(value);
      return name.length >= 2 ? name : null;
    }
    case "family_children_count":
      return normalizeChildrenCount(value);
    case "occupation":
    case "company_name": {
      const v = value.replace(/\s+/g, " ").trim().slice(0, 80);
      return v.length >= 2 ? v : null;
    }
    case "email": {
      const email = sanitizeSpokenEmailAddress(value.toLowerCase().replace(/\s+/g, ""));
      return EMAIL_RE.test(email) ? email : null;
    }
    case "language_pref":
      return normalizeLanguage(value);
    case "preferred_contact_method":
      return normalizeContactMethod(value);
    default:
      return null;
  }
}

export interface NormalizedDurableFact {
  key: DurableFactKey;
  value: string;
  confidence: number;
  sentenceIds: number[];
}

export type FactValidationRejectReason =
  | "unknown_key"
  | "empty_value"
  | "invalid_value"
  | "low_confidence"
  | "missing_citation"
  | "bad_citation"
  | "agent_attribution";

export interface FactValidationResult {
  ok: boolean;
  fact?: NormalizedDurableFact;
  reason?: FactValidationRejectReason;
}

/**
 * Map an LLM/regex fact onto the durable allowlist (no citation check).
 * Returns null when the key is ephemeral / unknown or the value fails the normalizer.
 */
export function normalizeDurableFact(opts: {
  key: string;
  value: unknown;
  confidence: number;
  sentenceIds?: number[];
}): NormalizedDurableFact | null {
  const key = canonicalizeFactKey(opts.key);
  if (!key) return null;
  if (typeof opts.confidence !== "number" || Number.isNaN(opts.confidence)) return null;
  if (opts.confidence < MIN_FACT_CONFIDENCE) return null;

  const value = normalizeFactValue(key, String(opts.value ?? ""));
  if (!value) return null;

  return {
    key,
    value,
    confidence: Math.min(1, opts.confidence),
    sentenceIds: (opts.sentenceIds ?? []).filter((id) => Number.isInteger(id) && id > 0),
  };
}

/**
 * Validation gate (design §4) — deterministic checks before writing caller_facts.
 * `callerSentenceIds` is the set of L2 sentence ids spoken by the caller this call.
 */
export function validateFactCandidate(opts: {
  key: string;
  value: unknown;
  confidence: number;
  sentenceIds?: number[];
  /** When set, every cited sentence must be in this caller-only set. */
  callerSentenceIds?: ReadonlySet<number>;
  /** When true (call-end path), require non-empty valid citations. */
  requireCitation?: boolean;
}): FactValidationResult {
  const key = canonicalizeFactKey(opts.key);
  if (!key) return { ok: false, reason: "unknown_key" };

  if (typeof opts.confidence !== "number" || Number.isNaN(opts.confidence)) {
    return { ok: false, reason: "low_confidence" };
  }
  if (opts.confidence < MIN_FACT_CONFIDENCE) {
    return { ok: false, reason: "low_confidence" };
  }

  const raw = String(opts.value ?? "").trim();
  if (!raw) return { ok: false, reason: "empty_value" };

  const value = normalizeFactValue(key, raw);
  if (!value) return { ok: false, reason: "invalid_value" };

  const sentenceIds = (opts.sentenceIds ?? []).filter((id) => Number.isInteger(id) && id > 0);

  if (opts.requireCitation) {
    if (sentenceIds.length === 0) return { ok: false, reason: "missing_citation" };
    if (opts.callerSentenceIds) {
      for (const sid of sentenceIds) {
        if (!opts.callerSentenceIds.has(sid)) {
          return { ok: false, reason: "agent_attribution" };
        }
      }
    }
  } else if (opts.callerSentenceIds && sentenceIds.length > 0) {
    for (const sid of sentenceIds) {
      if (!opts.callerSentenceIds.has(sid)) {
        return { ok: false, reason: "bad_citation" };
      }
    }
  }

  return {
    ok: true,
    fact: {
      key,
      value,
      confidence: Math.min(1, opts.confidence),
      sentenceIds,
    },
  };
}

/**
 * Whether a new validated fact should supersede the current DB value (design §5).
 * Same normalized value → no-op. Lower confidence than current (and < 0.8) → discard.
 */
export function shouldSupersedeFact(opts: {
  currentValue: string;
  currentConfidence: number;
  newValue: string;
  newConfidence: number;
}): "insert" | "noop" | "supersede" | "discard" {
  const cur = opts.currentValue.trim();
  const next = opts.newValue.trim();
  if (cur === next) return "noop";
  if (
    opts.newConfidence >= opts.currentConfidence
    || opts.newConfidence >= HIGH_CONFIDENCE_OVERRIDE
  ) {
    return "supersede";
  }
  return "discard";
}

/** Human labels for injection (keeps prompts readable). */
export const DURABLE_FACT_LABELS: Record<DurableFactKey, string> = {
  name: "name",
  age: "age",
  gender: "gender",
  location: "location / hometown",
  family_spouse_name: "spouse name",
  family_children_count: "children",
  occupation: "occupation",
  company_name: "company",
  email: "email",
  language_pref: "language preference",
  preferred_contact_method: "preferred contact",
};

/** Prompt fragment listing allowed durable keys for the extract LLM. */
export function durableFactsPromptBlock(): string {
  return (
    `DURABLE FACTS ONLY — extract ONLY stable identity attributes the CALLER stated about themselves.\n` +
    `Allowed fact keys (use exactly these snake_case keys — inventing keys is forbidden):\n` +
    `- name: caller's personal/human name\n` +
    `- age: age in years if stated\n` +
    `- gender: if explicitly stated\n` +
    `- location: city / hometown / where they live (canonical city name)\n` +
    `- family_spouse_name: spouse's name if stated\n` +
    `- family_children_count: number of children if stated\n` +
    `- occupation: their job / profession\n` +
    `- company_name: employer / company they work for\n` +
    `- email: email address if stated\n` +
    `- language_pref: preferred spoken language (hi/en/ta/te/kn/ml/mr/bn/gu/pa)\n` +
    `- preferred_contact_method: call | sms | whatsapp | email if stated\n\n` +
    `DO NOT store as facts (put in summary instead if relevant):\n` +
    `budget, interested_in, concerns, follow_up, timeline, policy/product preferences,\n` +
    `coverage amounts, quotes, temporary intent, objections, family_size, family_members.\n\n` +
    `Rules:\n` +
    `- Only facts the CALLER explicitly said about themselves — never the agent's speech, never inferred\n` +
    `- Every fact MUST include sentence_ids citing numbered CALLER lines from the transcript\n` +
    `- If you cannot cite a caller sentence, omit the fact\n` +
    `- If the caller states the same key twice, keep only the LAST-stated value\n` +
    `- confidence: 0.9+ = direct statement; ~0.7 = clear but indirect; omit anything weaker\n` +
    `- Be concise with values (e.g. "4" not "four children"; "Bengaluru" not "I live in Bangalore")\n` +
    `- name is ONLY a personal human name — never a plan, product, or topic`
  );
}

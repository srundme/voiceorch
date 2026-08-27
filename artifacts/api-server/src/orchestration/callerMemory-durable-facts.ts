/**
 * Durable caller facts — closed schema + normalizers + validation gate.
 *
 * Ephemeral sales state belongs in the call summary / episode, NOT in
 * caller_facts. Only verified, schema-constrained identity facts persist.
 */

import { reconstructSpokenEmail, sanitizeSpokenEmailAddress } from "./endpointing.js";
import { expandSpokenDigits, preferIndianPhone } from "../lib/disposition/spoken-digits.js";
import { normalizePhone } from "../lib/phone-normalize.js";

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
  "date_of_birth",
  "phone_number",
  "whatsapp_number",
  "language_pref",
  "preferred_contact_method",
  // Named policy/product the CALLER said they already hold (not an agent pitch).
  "existing_product",
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
  mail_id: "email",
  mail: "email",

  date_of_birth: "date_of_birth",
  dob: "date_of_birth",
  d_o_b: "date_of_birth",
  birth_date: "date_of_birth",
  birthdate: "date_of_birth",
  dateofbirth: "date_of_birth",
  born_on: "date_of_birth",
  birthday: "date_of_birth",

  phone_number: "phone_number",
  mobile_number: "phone_number",
  mobile: "phone_number",
  contact_number: "phone_number",
  alternate_phone: "phone_number",
  alt_number: "phone_number",
  phone_no: "phone_number",
  phonenumber: "phone_number",

  whatsapp_number: "whatsapp_number",
  wa_number: "whatsapp_number",
  whatsapp_no: "whatsapp_number",
  whatsapp_phone: "whatsapp_number",
  wtsp: "whatsapp_number",
  wtsp_number: "whatsapp_number",

  language_pref: "language_pref",
  language: "language_pref",
  preferred_language: "language_pref",
  spoken_language: "language_pref",
  lang: "language_pref",

  preferred_contact_method: "preferred_contact_method",
  contact_method: "preferred_contact_method",
  preferred_channel: "preferred_contact_method",

  existing_product: "existing_product",
  existing_policy: "existing_product",
  policy_name: "existing_product",
  current_policy: "existing_product",
  held_product: "existing_product",
  product_name: "existing_product",
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
    .map((w) => {
      // Keep native-script tokens as spoken (Tamil/Hindi/etc.). Only title-case
      // Latin words so "Murali" / "ARJUN" normalize cleanly without mangling
      // "முரளி" via toLowerCase().
      if (/[^\u0000-\u007f]/.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
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
  if (
    ["male", "m", "man", "boy", "ஆண்", "ஆண்கள்", "पुरुष", "मर्द", "लड़का"].includes(v)
  ) {
    return "male";
  }
  if (
    ["female", "f", "woman", "girl", "பெண்", "பெண்கள்", "महिला", "औरत", "लड़की"].includes(v)
  ) {
    return "female";
  }
  if (["other", "nonbinary", "non-binary", "மற்றவை", "अन्य"].includes(v)) return "other";
  return null;
}

function normalizeChildrenCount(raw: string): string | null {
  const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n) || n < 0 || n > 20) return null;
  return String(n);
}

const MONTH_INDEX: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

function formatYmd(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (dt.getTime() > todayUtc) return null;
  const age = today.getUTCFullYear() - year;
  if (year < 1905 || age > 120) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parse a caller-stated DOB into ISO YYYY-MM-DD, or null. */
export function extractDateOfBirthFactValue(raw: string): string | null {
  const t = String(raw ?? "").trim().replace(/[.,]/g, " ").replace(/\s+/g, " ");
  if (!t) return null;

  const iso = t.match(/\b((?:19|20)\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/);
  if (iso) return formatYmd(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dmy = t.match(/\b(0?[1-9]|[12]\d|3[01])[/\-.](0?[1-9]|1[0-2])[/\-.]((?:19|20)\d{2})\b/);
  if (dmy) return formatYmd(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));

  const monthNames = Object.keys(MONTH_INDEX).join("|");
  const dMonY = t.match(new RegExp(
    `\\b(0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?\\s+(${monthNames})\\s+((?:19|20)\\d{2})\\b`,
    "i",
  ));
  if (dMonY) {
    const month = MONTH_INDEX[dMonY[2]!.toLowerCase()];
    if (month) return formatYmd(Number(dMonY[3]), month, Number(dMonY[1]));
  }
  const monDY = t.match(new RegExp(
    `\\b(${monthNames})\\s+(0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?(?:\\s+|\\s*,\\s*)((?:19|20)\\d{2})\\b`,
    "i",
  ));
  if (monDY) {
    const month = MONTH_INDEX[monDY[1]!.toLowerCase()];
    if (month) return formatYmd(Number(monDY[3]), month, Number(monDY[2]));
  }

  const compact = t.replace(/\D/g, "");
  if (compact.length === 8) {
    const dmyCompact = formatYmd(Number(compact.slice(4)), Number(compact.slice(2, 4)), Number(compact.slice(0, 2)));
    if (dmyCompact) return dmyCompact;
    return formatYmd(Number(compact.slice(0, 4)), Number(compact.slice(4, 6)), Number(compact.slice(6, 8)));
  }
  return null;
}

/** India-first E.164 from digits or spoken digit words. */
export function extractPhoneFactValue(raw: string): string | null {
  const expanded = expandSpokenDigits(String(raw ?? ""));
  const picked = preferIndianPhone(expanded) ?? preferIndianPhone(expanded.replace(/\D/g, ""));
  if (!picked) return null;
  const digits = picked.replace(/\D/g, "");
  const ten = digits.length === 12 && digits.startsWith("91")
    ? digits.slice(2)
    : digits.length === 10
      ? digits
      : digits.slice(-10);
  if (!/^[6-9]\d{9}$/.test(ten)) return null;
  return normalizePhone(ten);
}

export function extractEmailFactValue(raw: string): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const reconstructed = reconstructSpokenEmail(text);
  const compact = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0];
  const candidate = reconstructed ?? compact ?? text;
  const email = sanitizeSpokenEmailAddress(candidate.toLowerCase().replace(/\s+/g, ""));
  return EMAIL_RE.test(email) ? email : null;
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
    case "email":
      return extractEmailFactValue(value);
    case "date_of_birth":
      return extractDateOfBirthFactValue(value);
    case "phone_number":
    case "whatsapp_number":
      return extractPhoneFactValue(value);
    case "language_pref":
      return normalizeLanguage(value);
    case "preferred_contact_method":
      return normalizeContactMethod(value);
    case "existing_product": {
      const v = value.replace(/\s+/g, " ").trim().slice(0, 80);
      if (v.length < 2) return null;
      if (/^(insurance|policy|plan|product|premium|coverage)$/i.test(v)) return null;
      return v;
    }
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
  date_of_birth: "date of birth",
  phone_number: "phone number",
  whatsapp_number: "WhatsApp number",
  language_pref: "language preference",
  preferred_contact_method: "preferred contact",
  existing_product: "existing product / policy",
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
    `- email: email address if stated (including spoken "name at gmail dot com")\n` +
    `- date_of_birth: date of birth as YYYY-MM-DD if they stated day+month+year\n` +
    `- phone_number: a phone/mobile they stated (E.164, e.g. +919876543210) — not the agent's number\n` +
    `- whatsapp_number: WhatsApp number they stated (E.164). If they said "same as my phone", copy phone_number\n` +
    `- language_pref: preferred spoken language (hi/en/ta/te/kn/ml/mr/bn/gu/pa)\n` +
    `- preferred_contact_method: call | sms | whatsapp | email if stated\n` +
    `- existing_product: named policy/product the CALLER said they already have (e.g. "Galaxy Marvel")\n\n` +
    `DO NOT store as facts (put in the episode summary instead if relevant):\n` +
    `budget, interested_in, follow_up, timeline, quotes, temporary intent, objections,\n` +
    `wellness upsells the AGENT mentioned, family_size, family_members.\n` +
    `Caller concerns MAY go in the episode summary, not as a fact key.\n\n` +
    `Episode summary (2-4 sentences) MUST include:\n` +
    `- The affirmed caller name (after any denial), city, job, company, email, DOB, phone, WhatsApp if they stated them\n` +
    `- Any existing_product they confirmed they already hold\n` +
    `- What they asked or needed, and how the call ended (completed / dropped / callback)\n` +
    `- Do NOT write agent pitches as if the caller said them\n\n` +
    `Multilingual / code-switch:\n` +
    `- Transcripts may be Tamil, Hindi, English, or mixed (e.g. "என்னோட பேரு Murali", "मेरा नाम Ravi").\n` +
    `- Extract the SAME durable keys regardless of language — do not skip because the line is not English.\n` +
    `- Keep personal names as spoken (Latin or native script). Use male|female|other for gender,\n` +
    `  language codes for language_pref, digits for age/children, canonical city names when clear.\n\n` +
    `Rules:\n` +
    `- Only facts the CALLER explicitly said about themselves — never the agent's speech, never inferred\n` +
    `- Every fact MUST include sentence_ids citing numbered CALLER lines from the transcript\n` +
    `- If you cannot cite a caller sentence, omit the fact\n` +
    `- If the caller states the same key twice, keep only the LAST-stated value\n` +
    `- If the caller DENIES a name then gives another ("என்னோட பேரு X கிடையாது என்னோட பேரு Y", "enoda peru Karthi, Rajeswari ella", "my name is not X, it's Y"), store Y only — never a negation word\n` +
    `- occupation includes code-mixed copulas ("நான் professor-ஆ இருக்கேன்", "I am a teacher")\n` +
    `- existing_product only if the CALLER named a product they already have — never copy the agent's script\n` +
    `- Always store date_of_birth, phone_number, whatsapp_number, and email when the CALLER said them\n` +
    `- Spoken digit phones ("nine eight seven…") and spoken emails must still be stored as digits / an address\n` +
    `- confidence: 0.9+ = direct statement; ~0.7 = clear but indirect; omit anything weaker\n` +
    `- Be concise with values (e.g. "4" not "four children"; "Bengaluru" not "I live in Bangalore")\n` +
    `- name is ONLY a personal human name — never a plan, product, topic, or question ("who's this")`
  );
}

/**
 * Durable caller facts — identity attributes that stay true across calls.
 *
 * Ephemeral sales state (interested_in, budget, follow_up, concerns, …) belongs
 * in the call summary / episode, NOT in caller_facts. Agents should re-discover
 * those; they should never re-ask name, hometown, family size, etc.
 */

/** Canonical keys we persist & inject as "known details". */
export const DURABLE_FACT_KEYS = [
  "name",
  "age",
  "gender",
  "location",
  "family_size",
  "children_count",
  "family_members",
  "occupation",
  "company_name",
  "email",
  "language_pref",
  "preferred_contact_method",
] as const;

export type DurableFactKey = (typeof DURABLE_FACT_KEYS)[number];

const DURABLE_SET = new Set<string>(DURABLE_FACT_KEYS);

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

  family_size: "family_size",
  household_size: "family_size",
  family_members_count: "family_size",
  members_in_family: "family_size",
  family_count: "family_size",

  children_count: "children_count",
  kids: "children_count",
  kids_count: "children_count",
  number_of_children: "children_count",
  number_of_kids: "children_count",
  num_children: "children_count",

  family_members: "family_members",
  family: "family_members",
  household: "family_members",
  family_details: "family_members",

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

export interface NormalizedDurableFact {
  key: DurableFactKey;
  value: string;
  confidence: number;
}

/**
 * Map an LLM/regex fact onto the durable allowlist.
 * Returns null when the key is ephemeral / unknown or the value is empty.
 */
export function normalizeDurableFact(opts: {
  key: string;
  value: unknown;
  confidence: number;
}): NormalizedDurableFact | null {
  const key = canonicalizeFactKey(opts.key);
  if (!key) return null;
  if (typeof opts.confidence !== "number" || Number.isNaN(opts.confidence)) return null;
  if (opts.confidence < 0.7) return null;

  const value = String(opts.value ?? "").trim().slice(0, 512);
  if (!value) return null;

  // Soft check: refuse obvious product/plan dumps for "name"
  if (key === "name" && /\b(plan|policy|package|premium|coverage|budget)\b/i.test(value)) {
    return null;
  }

  return { key, value, confidence: Math.min(1, opts.confidence) };
}

/** Human labels for injection (keeps prompts readable). */
export const DURABLE_FACT_LABELS: Record<DurableFactKey, string> = {
  name: "name",
  age: "age",
  gender: "gender",
  location: "location / hometown",
  family_size: "family size",
  children_count: "children",
  family_members: "family members",
  occupation: "occupation",
  company_name: "company",
  email: "email",
  language_pref: "language preference",
  preferred_contact_method: "preferred contact",
};

/** Prompt fragment listing allowed durable keys for the extract LLM. */
export function durableFactsPromptBlock(): string {
  return (
    `DURABLE FACTS ONLY — extract ONLY stable identity attributes the caller stated about themselves.\n` +
    `These are things that do not change from call to call (name, where they live/are from, family, job).\n` +
    `Allowed fact keys (use exactly these snake_case keys):\n` +
    `- name: caller's personal/human name\n` +
    `- age: age in years if stated\n` +
    `- gender: if explicitly stated\n` +
    `- location: city / hometown / where they live or belong\n` +
    `- family_size: number of people in the household if stated\n` +
    `- children_count: number of children if stated\n` +
    `- family_members: short description of family (e.g. "wife and 2 kids") if stated\n` +
    `- occupation: their job / profession\n` +
    `- company_name: employer / company they work for\n` +
    `- email: email address if stated\n` +
    `- language_pref: preferred spoken language if they asked for one\n` +
    `- preferred_contact_method: how they want to be reached (call/sms/whatsapp) if stated\n\n` +
    `DO NOT store as facts (put in summary instead if relevant):\n` +
    `budget, interested_in, concerns, follow_up, timeline, policy/product preferences,\n` +
    `coverage amounts, quotes, temporary intent, what they "want this call", objections.\n\n` +
    `Rules:\n` +
    `- Only facts the CALLER explicitly said about themselves — never the agent's questions or tool output\n` +
    `- Never infer or assume. If unsure, omit.\n` +
    `- confidence: 0.9+ = directly stated; below 0.9 → usually skip (only keep ≥ 0.85 when unmistakable)\n` +
    `- Be concise with values (e.g. "4" not "a family of four people"; "Chennai" not "I am from Chennai")\n` +
    `- name is ONLY a personal human name — never a plan, product, or topic`
  );
}

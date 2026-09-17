/**
 * Candidate intake field contract.
 *
 * The voice agent writes answers as it hears them ("male", "twentieth July
 * two thousand", "zero companies"), so each field owns a normalizer that turns
 * loose speech into the stored value. Rejecting instead of guessing keeps a
 * misheard answer out of the form: the agent can re-ask.
 *
 * Slash/dash dates are read DAY-first (20/07/2000 = 20 July 2000) — the form
 * is India-facing and the client's own UI renders dd/mm/yyyy.
 */
import type {
  IntakeDnd,
  IntakeEnglishCommunication,
  IntakeGender,
  IntakeQualification,
  IntakeShiftBase,
  IntakeWorkStatus,
} from "@workspace/db/schema";
import { canonicalCityName } from "./intake-screen.js";

export const INTAKE_FIELD_KEYS = [
  "firstName",
  "lastName",
  "phone",
  "email",
  "gender",
  "dateOfBirth",
  "workStatus",
  "totalCompanies",
  "city",
  "jobCity",
  "skillRole",
  "skill",
  "industry",
  "qualification",
  "shiftBase",
  "dnd",
  "englishCommunication",
] as const;

export type IntakeFieldKey = (typeof INTAKE_FIELD_KEYS)[number];

export type IntakeFieldValue = string | number | null;

/**
 * Per-field storage types. Kept explicit (rather than `string | number`) so a
 * normalized patch drops straight into a Drizzle insert/update without a cast
 * at the call site.
 */
export interface IntakeFieldValues {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  gender: IntakeGender | null;
  dateOfBirth: string | null;
  workStatus: IntakeWorkStatus | null;
  totalCompanies: number | null;
  city: string | null;
  jobCity: string | null;
  skillRole: string | null;
  skill: string | null;
  industry: string | null;
  qualification: IntakeQualification | null;
  shiftBase: IntakeShiftBase | null;
  dnd: IntakeDnd | null;
  englishCommunication: IntakeEnglishCommunication | null;
}

export interface IntakeFieldResult {
  ok: boolean;
  value?: IntakeFieldValue;
  error?: string;
}

const ok = (value: IntakeFieldValue): IntakeFieldResult => ({ ok: true, value });
const bad = (error: string): IntakeFieldResult => ({ ok: false, error });

function collapse(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

/** Blanking a field is legitimate — the agent corrects a wrong answer. */
function isBlank(raw: unknown): boolean {
  return raw === null || raw === undefined || collapse(raw) === "";
}

function personName(raw: unknown, label: string): IntakeFieldResult {
  const text = collapse(raw);
  if (text.length > 80) return bad(`${label} is too long`);
  // Speech-to-text has no surname vocabulary, so allow any letters/marks.
  if (/[0-9]/.test(text)) return bad(`${label} cannot contain digits`);
  return ok(text);
}

function phone(raw: unknown): IntakeFieldResult {
  const text = collapse(raw);
  const plus = text.startsWith("+");
  const digits = text.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return bad("Phone must be 7–15 digits");
  return ok(plus ? `+${digits}` : digits);
}

function isValidEmailAddress(text: string): boolean {
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(text) && text.length <= 254;
}

function withDefaultMailboxTld(domain: string): string {
  if (/\./.test(domain)) return domain;
  if (/^(gmail|yahoo|outlook|hotmail|icloud|rediffmail|protonmail)$/.test(domain)) {
    return `${domain}.com`;
  }
  return domain;
}

function email(raw: unknown): IntakeFieldResult {
  const rebuilt = rebuildSpokenEmail(collapse(raw));
  if (!rebuilt) return bad("Email is not a valid address");
  return ok(rebuilt);
}

/**
 * Pull the mailbox out of a spoken turn instead of gluing the whole
 * sentence together ("yeah my gmail id is gopi at gmail.com" must not
 * become yeahmygmailidisgopi@gmail.com).
 */
function rebuildSpokenEmail(spoken: string): string | null {
  let s = spoken
    .toLowerCase()
    .replace(/\bat[\s-]*the[\s-]*rate\b/g, " at ")
    .replace(/\bunderscore\b/g, "_")
    .replace(/\b(?:hyphen|dash)\b/g, "-")
    .replace(/\s+dot\s+/g, ".");

  const spelled = emailFromSpelledLetters(s);
  if (spelled && isValidEmailAddress(spelled)) return spelled;

  s = s.replace(/^.*?\b(?:e-?mail|gmail|mail)\s*(?:id|address)?\s*(?:is|:)?\s+/i, " ");
  s = s.replace(/\s+at\s+/g, "@").replace(/\s+/g, " ").trim();

  const atHit = s.match(
    /\b([a-z0-9._%+-]{2,64})\s*@\s*([a-z0-9][a-z0-9.-]*?)(?:\s*\.\s*([a-z]{2,24}))?\b/i,
  );
  if (atHit) {
    const local = atHit[1]!.replace(/\s+/g, "");
    const host = `${atHit[2]}${atHit[3] ? `.${atHit[3]}` : ""}`.replace(/\s+/g, "").replace(/[.,;:]+$/g, "");
    const addr = `${local}@${withDefaultMailboxTld(host)}`.toLowerCase();
    if (isValidEmailAddress(addr)) return addr;
  }

  const hostHit = s.match(
    /\b([a-z0-9._%+-]{2,64})\s+(gmail|yahoo|outlook|hotmail|icloud|rediffmail|protonmail)(?:\s*\.\s*([a-z]{2,}))?\b/i,
  );
  if (hostHit) {
    const addr = `${hostHit[1]}@${hostHit[2]}.${hostHit[3] || "com"}`.toLowerCase();
    if (isValidEmailAddress(addr)) return addr;
  }

  const compact = s.replace(/\s+/g, "");
  const compactHit = compact.match(/([a-z0-9._%+-]{2,64})@([a-z0-9.-]+\.[a-z]{2,})/i);
  if (compactHit) {
    const local = compactHit[1]!.toLowerCase();
    if (!/^(yeah|yes|ok|okay|my|the|gmail|email|mail)/.test(local) && !/gmailid|emailis|mygmail/.test(local)) {
      const addr = `${local}@${compactHit[2]!.toLowerCase()}`;
      if (isValidEmailAddress(addr)) return addr;
    }
  }
  return null;
}

/** "G O P I N W R K @gmail.com" beats a garbled "copy and work@gmail.com" in the same turn. */
function emailFromSpelledLetters(spoken: string): string | null {
  const re =
    /(?:^|[\s.,;:])((?:[A-Za-z][\s.\-]){2,}[A-Za-z])\s*(?:@|\bat\b)\s*([A-Za-z0-9.-]+(?:\.[A-Za-z]{2,})?)/gi;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(spoken)) !== null) {
    const local = m[1]!.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    const domain = withDefaultMailboxTld(m[2]!.replace(/\s+/g, "").replace(/[.,;:]+$/g, "").toLowerCase());
    if (local.length >= 3 && isValidEmailAddress(`${local}@${domain}`)) last = `${local}@${domain}`;
  }
  if (last) return last;
  const noAt = /(?:^|[\s.,;:])((?:[A-Za-z][\s.\-]){2,}[A-Za-z])\s+(gmail|yahoo|outlook|hotmail)\b/gi;
  while ((m = noAt.exec(spoken)) !== null) {
    const local = m[1]!.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    if (local.length >= 3) last = `${local}@${m[2]!.toLowerCase()}.com`;
  }
  return last;
}

const GENDER_WORDS: Record<string, IntakeGender> = {
  m: "MALE", male: "MALE", man: "MALE", boy: "MALE", gent: "MALE", gentleman: "MALE",
  f: "FEMALE", female: "FEMALE", woman: "FEMALE", girl: "FEMALE", lady: "FEMALE",
  o: "OTHER", other: "OTHER", others: "OTHER", transgender: "OTHER", nonbinary: "OTHER",
};

function gender(raw: unknown): IntakeFieldResult {
  const key = collapse(raw).toLowerCase().replace(/[^a-z]/g, "");
  const mapped = GENDER_WORDS[key];
  if (!mapped) return bad("Gender must be Male, Female or Other");
  return ok(mapped);
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function monthFromWord(word: string): number | null {
  const w = word.toLowerCase();
  const idx = MONTHS.findIndex((m) => m === w || m.slice(0, 3) === w.slice(0, 3));
  return idx === -1 ? null : idx + 1;
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Rejects 31 February instead of rolling it into March.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateOfBirth(raw: unknown): IntakeFieldResult {
  const text = collapse(raw).replace(/(\d+)(st|nd|rd|th)\b/gi, "$1");
  let out: string | null = null;

  const ymd = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const dmy = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  const dMonY = text.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/);
  const monDY = text.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);

  if (ymd) out = isoDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  else if (dmy) out = isoDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  else if (dMonY) {
    const month = monthFromWord(dMonY[2]!);
    out = month ? isoDate(Number(dMonY[3]), month, Number(dMonY[1])) : null;
  } else if (monDY) {
    const month = monthFromWord(monDY[1]!);
    out = month ? isoDate(Number(monDY[3]), month, Number(monDY[2])) : null;
  }

  if (!out) return bad("Date of birth must look like 20/07/2000");
  const year = Number(out.slice(0, 4));
  const todayIso = new Date().toISOString().slice(0, 10);
  if (out >= todayIso) return bad("Date of birth cannot be in the future");
  if (year < 1925) return bad("Date of birth year is not plausible");
  return ok(out);
}

function workStatus(raw: unknown): IntakeFieldResult {
  const text = collapse(raw).toLowerCase();
  if (/^(fresher|fresh|fresher's|no experience|nonexperienced|zero experience)$/.test(text)) {
    return ok("FRESHER" satisfies IntakeWorkStatus);
  }
  if (/^(experienced|experience|exp|working|working professional)$/.test(text)) {
    return ok("EXPERIENCED" satisfies IntakeWorkStatus);
  }
  return bad("Work status must be Fresher or Experienced");
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, none: 0, nil: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

function totalCompanies(raw: unknown): IntakeFieldResult {
  const text = collapse(raw).toLowerCase();
  const word = NUMBER_WORDS[text];
  const n = word ?? Number(text);
  if (!Number.isInteger(n)) return bad("Total companies must be a whole number");
  if (n < 0 || n > 40) return bad("Total companies must be between 0 and 40");
  return ok(n);
}

/** The client's form shows cities upper-cased. Bangalore spellings share one value. */
function cityName(raw: unknown, label: string): IntakeFieldResult {
  const text = collapse(raw);
  if (text.length > 80) return bad(`${label} is too long`);
  if (/[0-9]/.test(text)) return bad(`${label} cannot contain digits`);
  return ok(canonicalCityName(text));
}

const ENGLISH_WORDS: Record<string, IntakeEnglishCommunication> = {
  excellent: "EXCELLENT",
  verygood: "VERY_GOOD",
  good: "GOOD",
  average: "AVERAGE",
  poor: "POOR",
};

function englishCommunication(raw: unknown): IntakeFieldResult {
  const key = collapse(raw).toLowerCase().replace(/[^a-z]/g, "");
  const mapped = ENGLISH_WORDS[key];
  if (!mapped) return bad("English communication must be Excellent, Very good, Good, Average or Poor");
  return ok(mapped);
}

/** This campaign only hires this role / skill / industry — the agent does not ask them. */
export const INTAKE_LOCKED_FIELDS = {
  skillRole: "EXECUTIVE_SR_EXECUTIVE",
  skill: "INTERNATIONAL_VOICE_PROCESS",
  industry: "BPO_CALL_CENTER",
} as const;

export type IntakeLockedKey = keyof typeof INTAKE_LOCKED_FIELDS;

function lockedField(key: IntakeLockedKey, raw: unknown): IntakeFieldResult {
  const expected = INTAKE_LOCKED_FIELDS[key];
  if (isBlank(raw)) return ok(expected);
  const keyNorm = collapse(raw).toUpperCase().replace(/[^A-Z]/g, "_").replace(/_+/g, "_");
  const spoken = collapse(raw).toLowerCase().replace(/[^a-z]/g, "");
  const aliases: Record<IntakeLockedKey, string[]> = {
    skillRole: ["executivesrexecutive", "executivesenior", "srexecutive", "executive"],
    skill: ["internationalvoiceprocess", "internationalvoice", "voiceprocess"],
    industry: ["bpocallcenter", "bpo", "callcenter"],
  };
  if (keyNorm === expected || aliases[key].includes(spoken)) return ok(expected);
  return bad(`${key} is fixed for this campaign`);
}

function qualification(raw: unknown): IntakeFieldResult {
  const text = collapse(raw).toLowerCase().replace(/[^a-z]/g, "");
  if (/^(postgraduate|postgraduation|pg|masters|master|mba|mtech)$/.test(text)) {
    return ok("POST_GRADUATE" satisfies IntakeQualification);
  }
  if (/^(graduate|graduation|ug|bachelors|bachelor|degree)$/.test(text)) {
    return ok("GRADUATE" satisfies IntakeQualification);
  }
  return bad("Qualification must be Graduate or Post Graduation");
}

const SHIFT_WORDS: Record<string, IntakeShiftBase> = {
  any: "ANY",
  anyshift: "ANY",
  day: "DAY_ONLY",
  dayshift: "DAY_ONLY",
  dayshiftonly: "DAY_ONLY",
  night: "NIGHT_ONLY",
  nightshift: "NIGHT_ONLY",
  nightshiftonly: "NIGHT_ONLY",
  evening: "US",
  eveningshift: "US",
  evenings: "US",
  uk: "UK",
  ukshift: "UK",
  us: "US",
  usshift: "US",
  aus: "AUS",
  australia: "AUS",
  aussie: "AUS",
  ausshift: "AUS",
  domestic: "DOMESTIC",
  domesticshift: "DOMESTIC",
  rotational: "ROTATIONAL",
  rotating: "ROTATIONAL",
};

function shiftBase(raw: unknown): IntakeFieldResult {
  const key = collapse(raw).toLowerCase().replace(/[^a-z]/g, "");
  const mapped = SHIFT_WORDS[key];
  if (!mapped) {
    return bad("Shift must be Any, Day, Night, UK, US, AUS, Domestic or Rotational");
  }
  return ok(mapped);
}

function dnd(raw: unknown): IntakeFieldResult {
  const key = collapse(raw).toLowerCase().replace(/[^a-z]/g, "");
  if (/^(activate|dnd|donotdisturb|notinterested|optout)$/.test(key)) {
    return ok("ACTIVATE" satisfies IntakeDnd);
  }
  if (/^(deactivate|allow|interested|callagain)$/.test(key)) {
    return ok("DEACTIVATE" satisfies IntakeDnd);
  }
  return bad("DND must be Activate or Deactivate");
}

const NORMALIZERS: Record<IntakeFieldKey, (raw: unknown) => IntakeFieldResult> = {
  firstName: (v) => personName(v, "First name"),
  lastName: (v) => personName(v, "Last name"),
  phone,
  email,
  gender,
  dateOfBirth,
  workStatus,
  totalCompanies,
  city: (v) => cityName(v, "City"),
  jobCity: (v) => cityName(v, "Job city"),
  skillRole: (v) => lockedField("skillRole", v),
  skill: (v) => lockedField("skill", v),
  industry: (v) => lockedField("industry", v),
  qualification,
  shiftBase,
  dnd,
  englishCommunication,
};

export function isIntakeFieldKey(key: string): key is IntakeFieldKey {
  return (INTAKE_FIELD_KEYS as readonly string[]).includes(key);
}

/** Normalize one field. Blank clears it so a wrong answer can be withdrawn. */
export function normalizeIntakeField(key: IntakeFieldKey, raw: unknown): IntakeFieldResult {
  if (key in INTAKE_LOCKED_FIELDS) return lockedField(key as IntakeLockedKey, raw);
  if (isBlank(raw)) return ok(null);
  return NORMALIZERS[key](raw);
}

export interface IntakePatchResult {
  values: Partial<IntakeFieldValues>;
  errors: Array<{ field: string; message: string }>;
}

/**
 * Normalize a whole patch. Valid fields are kept even when a sibling fails, so
 * one misheard answer does not discard the rest of the turn.
 */
export function normalizeIntakePatch(input: Record<string, unknown>): IntakePatchResult {
  const values: Partial<IntakeFieldValues> = {};
  // The normalizer table is keyed by field, so the per-field type is only
  // recoverable here through one write-side cast.
  const sink = values as Record<IntakeFieldKey, IntakeFieldValue>;
  const errors: Array<{ field: string; message: string }> = [];

  for (const [key, raw] of Object.entries(input)) {
    if (!isIntakeFieldKey(key)) {
      errors.push({ field: key, message: "Unknown field" });
      continue;
    }
    const result = normalizeIntakeField(key, raw);
    if (result.ok) sink[key] = result.value ?? null;
    else errors.push({ field: key, message: result.error ?? "Invalid value" });
  }

  return { values, errors };
}

/** Fields the agent must collect on the call (English and DND are marked afterwards). */
export const INTAKE_REQUIRED_ON_CALL: readonly IntakeFieldKey[] = [
  "firstName", "lastName", "phone", "email", "gender", "dateOfBirth",
  "workStatus", "totalCompanies", "city", "jobCity",
  "qualification", "shiftBase",
];

/** Field keys still empty — what the agent should ask next. */
export function missingIntakeFields(
  row: Partial<Record<IntakeFieldKey, unknown>>,
): IntakeFieldKey[] {
  return INTAKE_REQUIRED_ON_CALL.filter((key) => {
    const v = row[key];
    return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  });
}

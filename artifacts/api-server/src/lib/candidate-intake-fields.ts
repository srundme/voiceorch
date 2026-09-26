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

function email(raw: unknown): IntakeFieldResult {
  const spoken = collapse(raw);
  const spelled = emailFromSpelledLetters(spoken);
  const text = (spelled ?? spoken)
    .toLowerCase()
    .replace(/\s+at\s+/g, "@")
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s+/g, "");
  if (!/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(text)) return bad("Email is not a valid address");
  if (text.length > 254) return bad("Email is too long");
  return ok(text);
}

/** "G O P I N W R K @gmail.com" beats a garbled "copy and work@gmail.com" in the same turn. */
function emailFromSpelledLetters(spoken: string): string | null {
  const re =
    /(?:^|[\s.,;:])((?:[A-Za-z][\s.\-]){2,}[A-Za-z])\s*(?:@|\bat\b)\s*([A-Za-z0-9.-]+\.[A-Za-z]{2,})/gi;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(spoken)) !== null) {
    const local = m[1]!.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    const domain = m[2]!.replace(/\s+/g, "").toLowerCase();
    if (local.length >= 3) last = `${local}@${domain}`;
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

const SMALL_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};
const TENS_NUMBERS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const DAY_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
  sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
};

/** "twentieth July two thousand" → "20 July 2000" so the date parsers can read it. */
function expandSpokenDate(text: string): string {
  let t = text.toLowerCase();
  t = t.replace(/\b(twenty|thirty)\s+(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\b/g, (_, ten: string, one: string) => {
    const base = ten === "twenty" ? 20 : 30;
    return String(base + (SMALL_NUMBERS[one] ?? 0));
  });
  t = t.replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth)\b/g, (word) => String(DAY_WORDS[word] ?? word));
  t = t.replace(/\btwo thousand(?:\s+and)?(?:\s+(twenty|thirty))?(?:\s+(one|two|three|four|five|six|seven|eight|nine))?\b/g, (_, ten: string | undefined, one: string | undefined) => {
    let year = 2000;
    if (ten && TENS_NUMBERS[ten]) year += TENS_NUMBERS[ten];
    if (one && SMALL_NUMBERS[one]) year += SMALL_NUMBERS[one];
    return String(year);
  });
  t = t.replace(/\bnineteen\s+(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:\s+(one|two|three|four|five|six|seven|eight|nine))?\b/g, (_, ten: string, one: string | undefined) => {
    let year = 1900 + (TENS_NUMBERS[ten] ?? 0);
    if (one && SMALL_NUMBERS[one]) year += SMALL_NUMBERS[one];
    return String(year);
  });
  return t;
}

function dateOfBirth(raw: unknown): IntakeFieldResult {
  const text = expandSpokenDate(collapse(raw)).replace(/(\d+)(st|nd|rd|th)\b/gi, "$1");
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
  if (/\b(fresher|freshers)\b/.test(text) || /\bno experience\b/.test(text)) {
    return ok("FRESHER" satisfies IntakeWorkStatus);
  }
  if (/\b(experienced|experience)\b/.test(text) || /\bworking professional\b/.test(text)) {
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

const CITY_FILLER = new Set([
  "i", "im", "am", "live", "living", "lives", "stay", "staying", "stays", "in", "at", "the",
  "from", "city", "currently", "now", "a", "my", "home", "is", "its", "want", "to", "work",
  "working", "based", "near",
]);

/** The client's form shows cities upper-cased (BENGALURU), so store them that way. */
function cityName(raw: unknown, label: string): IntakeFieldResult {
  const spoken = collapse(raw);
  const kept = spoken.split(" ").filter((word) => !CITY_FILLER.has(word.toLowerCase().replace(/[^a-z]/g, "")));
  const text = kept.length > 0 ? kept.join(" ") : spoken;
  if (text.length > 80) return bad(`${label} is too long`);
  if (/[0-9]/.test(text)) return bad(`${label} cannot contain digits`);
  return ok(text.toUpperCase());
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
  const spoken = collapse(raw).toLowerCase();
  const text = spoken.replace(/[^a-z]/g, "");
  if (/^(postgraduate|postgraduation|pg|masters|master|mba|mtech)$/.test(text) || /post\s*graduat/.test(spoken) || /\b(mba|masters?|mtech)\b/.test(spoken)) {
    return ok("POST_GRADUATE" satisfies IntakeQualification);
  }
  if (/^(graduate|graduation|ug|bachelors|bachelor|degree)$/.test(text) || /graduat|bachelor|\bdegree\b|\bug\b/.test(spoken)) {
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
  const spoken = collapse(raw).toLowerCase();
  const key = spoken.replace(/[^a-z]/g, "");
  const mapped = SHIFT_WORDS[key];
  if (mapped) return ok(mapped);
  if (/\b(us|u\.s\.|american)\b/.test(spoken) || spoken.includes("united states")) return ok("US");
  if (/\b(uk|u\.k\.)\b/.test(spoken) || spoken.includes("united kingdom")) return ok("UK");
  if (/\baus\b/.test(spoken) || spoken.includes("australia")) return ok("AUS");
  if (/rotat/.test(spoken)) return ok("ROTATIONAL");
  if (/domestic/.test(spoken)) return ok("DOMESTIC");
  if (/night/.test(spoken)) return ok("NIGHT_ONLY");
  if (/\bday\b/.test(spoken)) return ok("DAY_ONLY");
  if (/\bany\b/.test(spoken)) return ok("ANY");
  return bad("Shift must be Any, Day, Night, UK, US, AUS, Domestic or Rotational");
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

function foldSpeech(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9@.\s]/g, " ").replace(/\s+/g, " ").trim();
}

const DIGIT_WORDS: Record<string, number> = {
  zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9,
};
const TEEN_WORDS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS_WORDS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/**
 * The ear writes numbers the way Indian callers say them — "five six zero one
 * double zero", "twenty zero seven", "two thousand seven". Rewrite each run
 * of number words as digits so a spoken pincode or year can be matched.
 */
export function spokenNumbersToDigits(text: string): string {
  const words = text.split(" ").map((w) => w.replace(/\.$/, ""));
  const out: string[] = [];
  let run = "";
  const flush = () => {
    if (run) out.push(run);
    run = "";
  };
  const digit = (w: string | undefined): number | undefined =>
    w !== undefined && w in DIGIT_WORDS && ((w !== "oh" && w !== "o") || run !== "") ? DIGIT_WORDS[w] : undefined;

  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const next = words[i + 1];
    if (/^\d+$/.test(w)) {
      run += w;
    } else if ((w === "double" || w === "triple") && next !== undefined && next in DIGIT_WORDS) {
      run += String(DIGIT_WORDS[next]).repeat(w === "double" ? 2 : 3);
      i++;
    } else if (w in TENS_WORDS) {
      const unit = digit(next);
      if (unit) {
        run += String(TENS_WORDS[w]! + unit);
        i++;
      } else {
        run += String(TENS_WORDS[w]);
      }
    } else if (w in TEEN_WORDS) {
      run += String(TEEN_WORDS[w]);
    } else if (w === "thousand" && /[1-9]$/.test(run)) {
      let j = i + 1;
      if (words[j] === "and") j++;
      let tail = 0;
      const a = words[j];
      if (a !== undefined && a in TENS_WORDS) {
        tail = TENS_WORDS[a]!;
        j++;
        const unit = DIGIT_WORDS[words[j] ?? ""];
        if (unit) {
          tail += unit;
          j++;
        }
      } else if (a !== undefined && a in TEEN_WORDS) {
        tail = TEEN_WORDS[a]!;
        j++;
      } else if (a !== undefined && a in DIGIT_WORDS && a !== "oh" && a !== "o") {
        tail = DIGIT_WORDS[a]!;
        j++;
      }
      run = run.slice(0, -1) + String(Number(run.slice(-1)) * 1000 + tail);
      i = j - 1;
    } else if (digit(w) !== undefined) {
      run += String(digit(w));
    } else {
      flush();
      out.push(w);
    }
  }
  flush();
  return out.join(" ");
}

function compactSpeech(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function callerSaid(caller: string, word: string): boolean {
  const needle = compactSpeech(word);
  if (needle.length < 3) return false;
  return compactSpeech(caller).includes(needle);
}

function callerAffirmed(caller: string): boolean {
  return /\b(yes|yeah|yep|yup|sure|okay|ok|fine|comfortable|can do)\b/.test(foldSpeech(caller));
}

/**
 * Drop intake fields the caller did not actually say. A small model will fill
 * the whole form from memory (call 35614 invented a surname, a Gmail address,
 * and a pincode after "I don't know my pincode").
 */
export function groundIntakeWrite(
  args: Record<string, unknown>,
  callerText: string,
  lastAgentText = "",
): Record<string, unknown> {
  const caller = spokenNumbersToDigits(foldSpeech(callerText));
  const agent = foldSpeech(lastAgentText);
  const kept: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(args)) {
    if (raw == null || String(raw).trim() === "") continue;
    if (intakeValueWasSaid(key, raw, caller, agent)) kept[key] = raw;
  }
  return kept;
}

function intakeValueWasSaid(
  key: string,
  raw: unknown,
  caller: string,
  agent: string,
): boolean {
  const value = String(raw).trim();
  const pinKey = key === "pincode" || key === "pinCode" || key === "pin";
  if (pinKey) {
    const digits = value.replace(/\D/g, "");
    return digits.length === 6 && caller.replace(/\D/g, "").includes(digits);
  }
  if (key === "email") {
    const local = value.split("@")[0] ?? "";
    return /\b(gmail|email|mail|@|dot com|dot in)\b/.test(caller) && callerSaid(caller, local);
  }
  if (key === "firstName" || key === "lastName" || key === "city" || key === "jobCity") {
    return value.split(/\s+/).every((word) => callerSaid(caller, word));
  }
  if (key === "dateOfBirth") {
    const year = value.match(/\d{4}/)?.[0];
    return year != null && caller.includes(year);
  }
  if (key === "phone") {
    const digits = value.replace(/\D/g, "").slice(-10);
    return digits.length === 10 && caller.replace(/\D/g, "").includes(digits);
  }
  if (key === "workStatus") {
    const fresher = /fresher|freshers|no experience/.test(value.toLowerCase());
    return fresher ? /\bfresher\b/.test(caller) : /\bexperienced\b/.test(caller);
  }
  if (key === "qualification") {
    return /post/.test(value.toLowerCase())
      ? /post\s*graduate/.test(caller)
      : /\b(graduate|graduation|degree)\b/.test(caller);
  }
  if (key === "totalCompanies") {
    return /\b(zero|one|two|three|four|five|companies|company|fresher)\b/.test(caller)
      || /\d/.test(caller);
  }
  if (key === "shiftBase") {
    if (/\b(us|u\.s|night|rotational|rotating|day shift|domestic)\b/.test(caller)) return true;
    return callerAffirmed(caller) && /\b(shift|night)\b/.test(agent);
  }
  if (/^(servingNotice|wantsWfh|needsWeekendOff|hasCareerGap|otherDomain|missingEduDocs|missingExpDocs)$/.test(key)) {
    if (!callerAffirmed(caller) && !/\b(no|nope|not|don't|dont|cannot|can't)\b/.test(caller)) return false;
    const topic = key === "wantsWfh" ? "home|wfh|office"
      : key === "needsWeekendOff" ? "weekend|saturday"
      : key === "servingNotice" ? "notice"
      : key === "hasCareerGap" ? "gap"
      : key === "otherDomain" ? "domain|bpo"
      : "document";
    return new RegExp(topic).test(agent) || new RegExp(topic).test(caller);
  }
  return callerSaid(caller, value);
}

/** Field keys still empty — what the agent should ask next. */
export function missingIntakeFields(
  row: Partial<Record<IntakeFieldKey, unknown>>,
): IntakeFieldKey[] {
  return INTAKE_REQUIRED_ON_CALL.filter((key) => {
    const v = row[key];
    return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  });
}

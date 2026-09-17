/**
 * Recruiter screening graph for the inbound intake agent.
 *
 * Parent answers unlock, skip, or kill child questions. The live form still
 * holds every column; this module is what the agent is allowed to ask next
 * and whether finish_intake may pitch a JD.
 */
import type { CandidateIntake } from "@workspace/db";
import { expandSpokenDigits } from "./disposition/spoken-digits.js";
import { missingDispositionFields, type IntakeExtra, type IntakeScreen, type ScreenYesNo } from "./intake-dispositions.js";

export const SCREEN_FLAG_KEYS = [
  "servingNotice",
  "wantsWfh",
  "needsWeekendOff",
  "hasCareerGap",
  "otherDomain",
  "missingEduDocs",
  "missingExpDocs",
] as const;

export type ScreenFlagKey = (typeof SCREEN_FLAG_KEYS)[number];

function lettersKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z]/g, "");
}

/** Spoken / typed spellings of the city itself — all store as BANGALORE. */
const BLR_CITY_ALIASES = [
  "BANGALORE", "BENGALURU", "BENGALORE", "BANGALURU", "BANGLORE",
  "BENGLORE", "BANGLURU", "BENGALOORU", "BANGALOORU", "BENGALOORE",
];

const BLR_AREAS = [
  "JAYANAGAR", "WHITEFIELD", "HSR", "BELLANDUR", "KORAMANGALA", "INDIRANAGAR",
  "MARATHAHALLI", "HEBBAL", "MANYATA", "BANASHANKARI", "ELECTRONICCITY",
  "SARJAPUR", "MAHADEVAPURA", "YELAHANKA", "JPNAGAR", "BTM", "MALLESHWARAM",
];

/** Longest-first so HSR Layout / Whitefield beat the generic city PIN. */
const PIN_FOR_PLACE: Array<{ needle: string; pin: string }> = [
  { needle: "ELECTRONICCITY", pin: "560100" },
  { needle: "MAHADEVAPURA", pin: "560048" },
  { needle: "MARATHAHALLI", pin: "560037" },
  { needle: "BANASHANKARI", pin: "560070" },
  { needle: "KORAMANGALA", pin: "560034" },
  { needle: "INDIRANAGAR", pin: "560038" },
  { needle: "MALLESHWARAM", pin: "560003" },
  { needle: "WHITEFIELD", pin: "560066" },
  { needle: "JAYANAGAR", pin: "560041" },
  { needle: "BELLANDUR", pin: "560103" },
  { needle: "YELAHANKA", pin: "560064" },
  { needle: "SARJAPUR", pin: "560035" },
  { needle: "JPNAGAR", pin: "560078" },
  { needle: "MANYATA", pin: "560045" },
  { needle: "HEBBAL", pin: "560024" },
  { needle: "HSR", pin: "560102" },
  { needle: "BTM", pin: "560076" },
  { needle: "GOPALA", pin: "577201" },
  { needle: "PURUDAL", pin: "577211" },
  { needle: "SHIVAMOGGA", pin: "577201" },
  { needle: "SHIMOGA", pin: "577201" },
  ...BLR_CITY_ALIASES.map((needle) => ({ needle, pin: "560001" })),
];

export function isBangaloreCityName(value: string | null | undefined): boolean {
  const key = lettersKey(String(value ?? ""));
  if (!key) return false;
  if (key === "BLR") return true;
  return BLR_CITY_ALIASES.some((alias) => key === alias || key.startsWith(alias));
}

export function isBangalorePlace(value: string | null | undefined): boolean {
  if (isBangaloreCityName(value)) return true;
  const key = lettersKey(String(value ?? ""));
  if (!key) return false;
  return BLR_AREAS.some((area) => key.includes(lettersKey(area)));
}

/** Form spelling: Bangalore / Bengaluru / Bengalore all store as BANGALORE. */
export function canonicalCityName(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return trimmed;
  if (isBangaloreCityName(trimmed)) return "BANGALORE";
  return trimmed.toUpperCase();
}

/** 6-digit PIN inferred from a spoken city or Bangalore area. */
export function pincodeFromPlace(value: string | null | undefined): string | null {
  const key = lettersKey(String(value ?? ""));
  if (!key) return null;
  for (const row of PIN_FOR_PLACE) {
    const needle = lettersKey(row.needle);
    if (key === needle || key.includes(needle)) return row.pin;
  }
  return null;
}

/** Six-digit Indian PIN from digits or spoken digits ("five six zero double zero five"). */
export function parsePincode(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const expanded = expandSpokenDigits(text.toLowerCase());
  const digits = expanded.replace(/\D/g, "");
  // Exact 6 only — slicing 5600005 → 560000 (call 25244) is the wrong PIN.
  if (/^[1-8]\d{5}$/.test(digits)) return digits;
  const isolated = expanded.match(/\b([1-8]\d{5})\b/);
  if (isolated && digits.length === 6) return isolated[1]!;
  return null;
}

const COMPANY_PREFIX = /^(?:i(?:'m| am)?\s+)?(?:currently\s+)?(?:work(?:ing)?\s+)?(?:at|with|for)\s+/i;
const COMPANY_LABEL = /^(?:it'?s|the company is|company(?: name)? is)\s+/i;
const NOT_A_COMPANY = new Set(["yes", "no", "none", "na", "nil", "fresher", "experienced", "experience"]);

/** Current or last employer as the candidate said it. */
export function parseLastCompany(raw: unknown): string | null {
  let text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  text = text.replace(COMPANY_PREFIX, "").replace(COMPANY_LABEL, "").replace(/\s+/g, " ").trim();
  if (text.length < 2 || text.length > 80) return null;
  const key = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (NOT_A_COMPANY.has(key)) return null;
  return text;
}

const TENURE_WORDS: Record<string, number> = {
  zero: 0, half: 0.5, a: 1, an: 1,
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12,
};

function tenureWordOrNumber(raw: string): number | null {
  if (TENURE_WORDS[raw] != null) return TENURE_WORDS[raw]!;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Working tenure as a display string — "2 years", "6 months", "2 years 6 months". */
export function parseTenure(raw: unknown): string | null {
  const text = String(raw ?? "").toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;

  const word = Object.keys(TENURE_WORDS).join("|");
  const yearRe = new RegExp(`\\b(?:(\\d+(?:\\.\\d+)?)|(${word}))\\s*(?:years?|yrs?)\\b`, "g");
  const monthRe = new RegExp(`\\b(?:(\\d+(?:\\.\\d+)?)|(${word}))\\s*(?:months?|mos?)\\b`, "g");

  let years = 0;
  let months = 0;
  let matched = false;
  for (const m of text.matchAll(yearRe)) {
    const n = tenureWordOrNumber(m[1] ?? m[2] ?? "");
    if (n == null) continue;
    years += n;
    matched = true;
  }
  for (const m of text.matchAll(monthRe)) {
    const n = tenureWordOrNumber(m[1] ?? m[2] ?? "");
    if (n == null) continue;
    months += n;
    matched = true;
  }
  if (!matched) {
    const bare = text.match(new RegExp(`^(?:(\\d+(?:\\.\\d+)?)|(${word}))$`));
    const n = bare ? tenureWordOrNumber(bare[1] ?? bare[2] ?? "") : null;
    if (n == null) return null;
    years = n;
  }

  months += Math.round((years - Math.floor(years)) * 12);
  years = Math.floor(years);
  while (months >= 12) {
    years += 1;
    months -= 12;
  }
  if (years > 40 || months > 11) return null;
  if (years === 0 && months === 0) return "0 months";
  const parts: string[] = [];
  if (years > 0) parts.push(years === 1 ? "1 year" : `${years} years`);
  if (months > 0) parts.push(months === 1 ? "1 month" : `${months} months`);
  return parts.join(" ") || null;
}

export function screenLastCompany(extra: IntakeExtra): string | null {
  const value = extra.screen?.lastCompany?.trim();
  return value ? value : null;
}

export function screenTenure(extra: IntakeExtra): string | null {
  const value = extra.screen?.tenure?.trim();
  return value ? value : null;
}

/** Bangalore Urban 560xxx and Bangalore Rural 562xxx. */
export function isBangalorePincode(pin: string | null | undefined): boolean {
  const p = parsePincode(pin);
  return Boolean(p && (p.startsWith("560") || p.startsWith("562")));
}

/**
 * Client non-hiring areas from the form (Shimoga). Exact pins for the named
 * localities; other 5772xx land on Others.
 */
const NON_HIRING_PIN_AREAS: Record<string, string> = {
  "577201": "Gopala Extension, Shimoga - Karnataka",
  "577203": "Gopala Extension, Shimoga - Karnataka",
  "577204": "Gopala Extension, Shimoga - Karnataka",
  "577205": "Gopala Extension, Shimoga - Karnataka",
  "577202": "Purudal, Shimoga - Karnataka",
  "577211": "Purudal, Shimoga - Karnataka",
};

export function nonHiringAreaForPincode(pin: string | null | undefined): string | null {
  const p = parsePincode(pin);
  if (!p) return null;
  if (NON_HIRING_PIN_AREAS[p]) return NON_HIRING_PIN_AREAS[p]!;
  if (p.startsWith("5772")) return "Others";
  return null;
}

export function screenPincode(extra: IntakeExtra): string | null {
  return parsePincode(extra.screen?.pincode)
    ?? parsePincode(extra.answers["non_hiring_zone"]?.["candidate_pincode"]);
}

/** Pincode wins over the spoken city when both are present. */
export function livesInBangalore(city: string | null | undefined, extra: IntakeExtra): boolean {
  const pin = screenPincode(extra);
  if (pin) return isBangalorePincode(pin);
  return isBangalorePlace(city);
}

export function parseScreenYesNo(raw: unknown): ScreenYesNo | null {
  const text = String(raw ?? "").toLowerCase();
  const key = text.replace(/[^a-z]/g, "");
  if (!key) return null;
  if (/^(yes|y|true|yeah|yep|haan|ha|ok|okay|sure)$/.test(key)) return "yes";
  if (/^(no|n|false|nah|nope)$/.test(key)) return "no";
  // Word "not", not the letters inside "notice".
  if (/\bnot\b/.test(text) && /\bnotice\b/.test(text)) return "no";
  if (/\bserving\b/.test(text) || /\bnotice\b/.test(text)) return "yes";
  if (key.includes("office") && !key.includes("home")) return "no";
  if (key.includes("wfh") || key.includes("fromhome") || key.includes("workfromhome")) return "yes";
  return null;
}

function filled(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

function flag(extra: IntakeExtra, key: ScreenFlagKey): ScreenYesNo | null {
  return extra.screen?.[key] ?? null;
}

function has(extra: IntakeExtra, id: string): boolean {
  return extra.dispositionIds.includes(id);
}

function ans(extra: IntakeExtra, id: string, field: string): string | number | null {
  return extra.answers[id]?.[field] ?? null;
}

function ageYears(iso: string | null | undefined): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const born = new Date(`${iso}T00:00:00Z`);
  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const md = now.getUTCMonth() - born.getUTCMonth();
  if (md < 0 || (md === 0 && now.getUTCDate() < born.getUTCDate())) age -= 1;
  return age;
}

const US_OK: ReadonlySet<string> = new Set(["US", "NIGHT_ONLY", "ANY", "ROTATIONAL", "UK", "AUS"]);

function englishPoor(extra: IntakeExtra): boolean {
  const read = extra.english;
  if (!read || read.samples < 2) return false;
  return read.rating === "Poor" && read.confidence >= 0.35;
}

export interface IntakeScreenCue {
  /** Next thing the recruiter should do — one turn. */
  instruction: string;
  /** Everything still blocking finish_intake. */
  waitingOn: string[];
  canFinish: boolean;
  pitchAllowed: boolean;
  killReason: string | null;
}

type Row = Pick<
  CandidateIntake,
  | "firstName" | "lastName" | "phone" | "email" | "gender" | "dateOfBirth"
  | "workStatus" | "totalCompanies" | "city" | "jobCity" | "qualification"
  | "shiftBase" | "dnd"
>;

/**
 * Walks the recruiter tree. First incomplete gate is the spoken next step.
 * `waitingOn` is the full remainder so finish_intake can refuse with a list.
 */
export function evaluateIntakeScreen(row: Row, extra: IntakeExtra): IntakeScreenCue {
  const waitingOn: string[] = [];
  let instruction: string | null = null;
  const take = (label: string, say: string) => {
    waitingOn.push(label);
    if (!instruction) instruction = say;
  };

  if (row.dnd === "ACTIVATE") {
    return {
      instruction: "DND is on. Confirm you will not call again, then end_call. Do not pitch a job.",
      waitingOn: [],
      canFinish: true,
      pitchAllowed: false,
      killReason: "DND",
    };
  }

  if (!filled(row.firstName)) {
    take(
      "first name",
      "Do not ask for the name until you know why they called. When they want help finding work, say you need a few details to match the right opening, then ask their name — skip the name if they already gave it. Save firstName (and lastName if they give it).",
    );
  }
  if (!filled(row.lastName)) {
    take("last name", "Ask their surname and save lastName.");
  }

  if (!filled(row.email)) {
    take("email", "Ask their email, spell it back, and save email.");
  }

  if (!filled(row.qualification)) {
    take("graduate or post graduate", "Ask if they are a graduate or post graduate and save qualification.");
  }
  if (!flag(extra, "missingEduDocs")) {
    take(
      "missingEduDocs",
      "Ask if they can share education documents for verification. Save missingEduDocs as no if they can, yes if they cannot.",
    );
  }

  if (!filled(row.workStatus)) {
    take("fresher or experienced", "Ask if they are a fresher or already working. Save workStatus.");
  } else if (row.workStatus === "FRESHER") {
    // companies auto-0; skip company name, tenure, notice, experience letters
  } else {
    const lastCompany = screenLastCompany(extra);
    const tenure = screenTenure(extra);
    const companyCount = row.totalCompanies == null ? null : Number(row.totalCompanies);
    if (companyCount == null || companyCount < 1) {
      take(
        "number of companies",
        "Ask how many companies they have worked with, including last year. Save totalCompanies. One company → ask that name next; more than one → ask those company names.",
      );
    } else if (!lastCompany) {
      take(
        "lastCompany",
        companyCount > 1
          ? `They worked with ${companyCount} companies. Ask those company names and save lastCompany as the list.`
          : "They worked with one company. Ask that company name and save lastCompany. If they said last year, save tenure as 1 year.",
      );
    }
    if (companyCount != null && companyCount >= 1 && !tenure) {
      take("tenure", "If they have not already said how long, ask working tenure and save tenure. Last year means 1 year.");
    }
    if (!flag(extra, "servingNotice")) {
      take(
        "servingNotice",
        "Ask if they are serving notice. Save servingNotice as yes or no. If yes, save noticePeriod (15/30/45/60/90 Days) and lastWorkingDay on the same save — a day like 28 is the 28th, and add a short notice remark. Do not re-ask after both are saved.",
      );
    } else if (flag(extra, "servingNotice") === "yes") {
      const missing = missingDispositionFields(extra).filter((k) => k.startsWith("serving_notice.") && k !== "serving_notice.notice_remarks");
      if (missing.length > 0 || !has(extra, "serving_notice")) {
        take(
          "serving_notice fields",
          "They are serving notice. Save noticePeriod as 15 Days, 30 Days, 45 Days, 60 Days or 90 Days, lastWorkingDay (a spoken 28 is the 28th), and a short notice_remarks note. Do not ask the same question again once those are in.",
        );
      }
    }
    if (!flag(extra, "hasCareerGap")) {
      take(
        "hasCareerGap",
        "Ask if they have a career gap. Save hasCareerGap as yes or no. If yes, set_disposition career_gap and take duration and reason.",
      );
    } else if (flag(extra, "hasCareerGap") === "yes" && (!has(extra, "career_gap") || missingDispositionFields(extra).some((k) => k.startsWith("career_gap.")))) {
      take("career_gap fields", "Record career_gap and ask gap duration and reason.");
    }
    if (!flag(extra, "otherDomain")) {
      take(
        "otherDomain",
        "Ask if their experience is voice/BPO or another domain. Save otherDomain as no for voice/BPO, yes otherwise. If yes, set_disposition other_domain_experience with the domain and whether they want a BPO job.",
      );
    } else if (flag(extra, "otherDomain") === "yes" && (!has(extra, "other_domain_experience") || missingDispositionFields(extra).some((k) => k.startsWith("other_domain_experience.")))) {
      take(
        "other_domain_experience fields",
        "Record other_domain_experience. Ask the domain and whether they want a BPO voice job. Save other_domain_experience.domain and other_domain_experience.interested_in_bpo.",
      );
    }
    if (!flag(extra, "missingExpDocs")) {
      take(
        "missingExpDocs",
        "Ask if they can share experience or relieving letters when lined up. Save missingExpDocs as no if they can, yes if they cannot.",
      );
    }
  }

  if (!filled(row.city)) {
    take("city they live in", "Ask which city or area they live in now and save city. Bangalore, Bengaluru and Bengalore are the same city. If they name a Bangalore area (HSR, Whitefield), save that. Do not ask for a pincode — the system fills it from the city or area.");
  }

  const pin = screenPincode(extra);
  const inBlr = livesInBangalore(row.city, extra);

  if (filled(row.city) && !inBlr) {
    if (!has(extra, "out_station_candidate")) {
      take(
        "out_station_candidate",
        "They are not in Bangalore. Record set_disposition out_station_candidate, save out_station_candidate.candidate_location, and ask whether they will relocate to Bangalore. Send will_relocate as Yes or No. Do not ask for a pincode.",
      );
    } else if (!filled(ans(extra, "out_station_candidate", "will_relocate"))) {
      take(
        "out_station_candidate.will_relocate",
        "Ask if they will relocate to Bangalore for an office-based voice process. Save out_station_candidate.will_relocate as Yes or No.",
      );
    }
    const zone = nonHiringAreaForPincode(pin ?? pincodeFromPlace(row.city));
    if (zone && !has(extra, "non_hiring_zone")) {
      take(
        "non_hiring_zone",
        `This location is a non-hiring zone (${zone}). Record non_hiring_zone, save non_hiring_zone.select_area, then ask PG vs family and whether they will relocate.`,
      );
    } else if (has(extra, "non_hiring_zone") && !filled(ans(extra, "non_hiring_zone", "will_relocate"))) {
      take(
        "non_hiring_zone.will_relocate",
        "Ask if they will relocate out of this non-hiring zone into Bangalore. Save non_hiring_zone.will_relocate as Yes or No.",
      );
    }
  }

  if (!filled(row.jobCity)) {
    if (filled(row.city) && inBlr) {
      take("job city", "They live in Bangalore — confirm they want to work there and save jobCity as Bangalore.");
    } else if (filled(row.city)) {
      take("job city", "Ask which city they want to work in. Our openings are Bangalore. Save jobCity.");
    }
  } else if (!isBangalorePlace(row.jobCity) && !has(extra, "no_company") && !has(extra, "out_station_candidate")) {
    take(
      "no_company",
      "They do not want Bangalore. Record no_company with reason No Company Available. Do not pitch.",
    );
  }

  const relocateNo = ans(extra, "out_station_candidate", "will_relocate") === "No"
    || ans(extra, "non_hiring_zone", "will_relocate") === "No";
  const jobNotBlr = filled(row.jobCity) && !isBangalorePlace(row.jobCity);

  if (!filled(row.dateOfBirth)) {
    take("date of birth", "Ask date of birth and save dateOfBirth.");
  } else {
    const age = ageYears(row.dateOfBirth);
    if (age != null && (age < 18 || age > 40) && !has(extra, "age_limit")) {
      take(
        "age_limit",
        "They are outside the usual 18–40 hiring window. Record age_limit and save age_limit.date_of_birth. Do not pitch yet.",
      );
    }
  }

  if (!filled(row.shiftBase)) {
    take(
      "shift they can work",
      "Ask once whether they can do night shift and evening shift. If they can do either or both, save shiftBase as US and do not ask again.",
    );
  } else if (!US_OK.has(String(row.shiftBase))) {
    if (!has(extra, "shift_issues") || !filled(ans(extra, "shift_issues", "willing_for_alternate_shift"))) {
      take(
        "shift_issues",
        "They cannot do night or evening. Ask once if they would take that shift anyway. Save shift_issues.willing_for_alternate_shift as Yes or No. Do not repeat the shift question.",
      );
    }
  }

  if (!flag(extra, "wantsWfh")) {
    take(
      "wantsWfh",
      "Tell them openings are office-based in Bangalore. Ask if that is okay or they need work from home. Save wantsWfh as no if office is fine, yes if they need WFH. If they later say they will come to office, uncheck WFH (wantsWfh no) and save willing_to_work_from_office as Yes — do not keep asking for a WFH reason.",
    );
  } else if (flag(extra, "wantsWfh") === "yes" && (!has(extra, "work_from_home") || !filled(ans(extra, "work_from_home", "willing_to_work_from_office")))) {
    take(
      "work_from_home",
      "They said WFH. Confirm once: will they come to office? If they will, save wantsWfh as no and work_from_home.willing_to_work_from_office as Yes, and stop asking for a WFH reason.",
    );
  }

  if (!flag(extra, "needsWeekendOff")) {
    take(
      "needsWeekendOff",
      "Ask if they need a fixed weekend off, or rotational week-offs are fine. Save needsWeekendOff as yes only if they must have Saturday-Sunday off.",
    );
  }

  if (englishPoor(extra) && !has(extra, "poor_communication")) {
    take(
      "poor_communication",
      "Their English on this call is below voice-process level. Record poor_communication with the closest communication_issue. Do not pitch a job.",
    );
  }

  const missingOpened = missingDispositionFields(extra);
  for (const key of missingOpened) {
    if (flag(extra, "wantsWfh") !== "yes" && key.startsWith("work_from_home.")) continue;
    if (key === "serving_notice.notice_remarks") continue;
    if (!waitingOn.includes(key)) {
      take(key, `An outcome is still missing ${key}. Ask it in your own words and send it through set_disposition.`);
    }
  }

  const officeNo = flag(extra, "wantsWfh") === "yes"
    && ans(extra, "work_from_home", "willing_to_work_from_office") === "No";
  const shiftNo = filled(row.shiftBase)
    && !US_OK.has(String(row.shiftBase))
    && ans(extra, "shift_issues", "willing_for_alternate_shift") === "No";
  const domainNo = flag(extra, "otherDomain") === "yes"
    && ans(extra, "other_domain_experience", "interested_in_bpo") === "No";
  const notInterested = has(extra, "not_interested");
  const poorComm = has(extra, "poor_communication") || englishPoor(extra);

  const age = ageYears(row.dateOfBirth);
  const ageOut = age != null && (age < 18 || age > 40);

  let killReason: string | null = null;
  if (notInterested) killReason = "not_interested";
  else if (poorComm) killReason = "poor_communication";
  else if (relocateNo) killReason = "will_not_relocate";
  else if (jobNotBlr) killReason = "job_city_not_bangalore";
  else if (officeNo) killReason = "wfh_only";
  else if (shiftNo) killReason = "cannot_do_shift";
  else if (domainNo) killReason = "not_interested_in_bpo";
  else if (ageOut) killReason = "age_limit";

  const canFinish = waitingOn.length === 0;
  const pitchAllowed = canFinish && !killReason;

  return {
    instruction: instruction
      ?? (pitchAllowed
        ? "Screening is complete and they are eligible. Call finish_intake and pitch the opening it returns."
        : `Screening is complete but they are not eligible (${killReason}). Call finish_intake. Speak the reason, say no jobs for their profile are matched as of now, then end_call. Do not hang up silently.`),
    waitingOn,
    canFinish,
    pitchAllowed,
    killReason,
  };
}

/** Dispositions the tree just opened from a parent answer — pre-fill what we already know. */
export function autoAnswersForDisposition(
  id: string,
  row: Row,
  extra: IntakeExtra,
): Record<string, string | number | null> {
  if (id === "out_station_candidate") {
    return { candidate_location: row.city ?? "" };
  }
  if (id === "non_hiring_zone") {
    const pin = screenPincode(extra);
    return {
      candidate_pincode: pin ?? "",
      select_area: nonHiringAreaForPincode(pin) ?? "Others",
    };
  }
  if (id === "age_limit") {
    return { date_of_birth: row.dateOfBirth ?? "" };
  }
  if (id === "no_company") {
    return { reason: "No Company Available" };
  }
  if (id === "shift_issues") {
    const issue = row.shiftBase === "DAY_ONLY" ? "Night Shift" : "US Shift";
    return { shift_issue: issue };
  }
  if (id === "need_weekend_off") {
    const eng = extra.english?.rating ?? "Good";
    return {
      skill_role: "Executive / Sr Executive",
      skill: "International Voice Process",
      english_communication: eng,
      date_of_birth: row.dateOfBirth ?? "",
      bpo_experience: row.workStatus === "FRESHER" ? "FRESHER" : "EXPERIENCED",
      qualification: "Graduate",
      shift_base: "US Shift",
      dnd: "Deactivate",
    };
  }
  return {};
}

export function mergeScreenFlags(
  current: IntakeScreen | null | undefined,
  patch: Partial<IntakeScreen>,
): IntakeScreen {
  return { ...(current ?? {}), ...patch };
}

/** Map a yes-flag onto the outcome id it should open. */
export const SCREEN_FLAG_TO_DISPOSITION: Record<ScreenFlagKey, string | null> = {
  servingNotice: "serving_notice",
  wantsWfh: "work_from_home",
  needsWeekendOff: "need_weekend_off",
  hasCareerGap: "career_gap",
  otherDomain: "other_domain_experience",
  missingEduDocs: "no_education_documents",
  missingExpDocs: "no_experience_documents",
};

/**
 * Conditional disposition fields for the live candidate intake form.
 *
 * The client JSON is the contract: picking a disposition reveals that
 * disposition's fields. Answers live in `candidate_intakes.extra` so the
 * typed customer/job columns stay untouched. Selects with no options are
 * free text — the JSON left those lists empty on purpose.
 */
export type IntakeDispositionFieldType =
  | "select"
  | "textarea"
  | "text"
  | "number"
  | "radio"
  | "date"
  | "time";

export interface IntakeDispositionField {
  id: string;
  label: string;
  type: IntakeDispositionFieldType;
  required: boolean;
  options?: readonly string[];
}

export interface IntakeDisposition {
  id: string;
  name: string;
  type: "conditional";
  fields: readonly IntakeDispositionField[];
  warning?: string;
}

/** A live read on how the caller is speaking, updated as the call runs. */
export interface IntakeEnglishRead {
  rating: "Excellent" | "Very good" | "Good" | "Average" | "Poor";
  /** 0–1. Low until there is enough caller speech to judge. */
  confidence: number;
  /** Short human-readable reasons, newest last. */
  evidence: string[];
  /** Caller turns considered so far. */
  samples: number;
}

/**
 * A candidate can hit several outcomes at once — wants WFH *and* needs
 * weekend off *and* is serving notice — so outcomes are a list, and answers
 * are namespaced per outcome because ids like `reason` and `date_of_birth`
 * mean different things under different outcomes.
 */
export type ScreenYesNo = "yes" | "no";

/** Parent-answer flags that drive child outcomes. Not shown as form columns. */
export interface IntakeScreen {
  servingNotice?: ScreenYesNo | null;
  wantsWfh?: ScreenYesNo | null;
  needsWeekendOff?: ScreenYesNo | null;
  hasCareerGap?: ScreenYesNo | null;
  otherDomain?: ScreenYesNo | null;
  missingEduDocs?: ScreenYesNo | null;
  missingExpDocs?: ScreenYesNo | null;
  /** 6-digit Indian PIN — hiring zone depends on this, not only the city name. */
  pincode?: string | null;
  /** Current or last employer — experienced path only. */
  lastCompany?: string | null;
  /** Working tenure as a display string, e.g. "2 years 6 months". */
  tenure?: string | null;
}

export interface IntakeExtra {
  dispositionIds: string[];
  answers: Record<string, Record<string, string | number | null>>;
  /** Live English assessment from the caller's own speech. */
  english?: IntakeEnglishRead | null;
  /** Recruiter tree answers (notice / WFH / weekend / gap / domain / docs). */
  screen?: IntakeScreen | null;
  /** Set when the form is closed — proposed JD + candidate profile snapshot. */
  match?: Record<string, unknown> | null;
}

export interface DispositionPatchResult {
  extra: IntakeExtra;
  written: string[];
  errors: Array<{ field: string; message: string }>;
}

const field = (
  id: string,
  label: string,
  type: IntakeDispositionFieldType,
  required: boolean,
  options?: readonly string[],
): IntakeDispositionField => (options ? { id, label, type, required, options } : { id, label, type, required });

/** Shared across Non Hiring Zone, Non Hiring University, and Cooling Period. */
export const INTAKE_COMPANIES = [
  "Concentrix",
  "Startek",
  "Ackoo General Insurance",
  "LivSpace",
  "Teleperformance",
  "First Advantage",
  "Globiiva",
  "[24]7.AI",
  "Azuga",
  "KGISL",
  "No Broker",
  "Teligent",
  "Edureka",
  "Fidelity",
  "Omega Health Care",
] as const;

export const INTAKE_DISPOSITIONS: readonly IntakeDisposition[] = [
  {
    id: "poor_communication",
    name: "Poor Communication",
    type: "conditional",
    fields: [
      field("communication_issue", "Communication Issue", "select", true, [
        "Unable to Understand English",
        "Unable to Speak English",
        "Unable to Understand Candidate",
        "Language Barrier",
        "Poor Verbal Communication",
        "Other",
      ]),
      field("additional_notes", "Additional Notes", "textarea", false),
    ],
  },
  {
    id: "non_hiring_zone",
    name: "Non Hiring Zone",
    type: "conditional",
    fields: [
      field("candidate_pincode", "Candidate Pincode", "text", true),
      field("select_area", "Select Area", "select", true, [
        "Gopala Extension, Shimoga - Karnataka",
        "Purudal, Shimoga - Karnataka",
        "Others",
      ]),
      field("company", "Which company was this a no hiring zone for?", "select", true, INTAKE_COMPANIES),
      field("select_process", "Select Process", "select", true),
      field("stay_location", "Does the candidate stay in PG or with Family?", "radio", true, [
        "PG",
        "With Family",
      ]),
      field("will_relocate", "Will the candidate relocate?", "radio", true, ["Yes", "No"]),
    ],
  },
  {
    id: "not_interested",
    name: "Not Interested",
    type: "conditional",
    fields: [
      field("reason", "Reason for Not Interested", "select", true, [
        "Not Interested in Job",
        "Already Placed",
        "Not Looking for Job",
        "Personal Reasons",
        "Other",
      ]),
      field("additional_notes", "Additional Notes", "textarea", false),
    ],
  },
  {
    id: "high_salary",
    name: "High Salary",
    type: "conditional",
    fields: [
      field("expected_salary", "Expected Salary", "number", true),
      field("salary_negotiable", "Is the candidate willing to negotiate salary?", "radio", true, ["Yes", "No"]),
      field("willing_lower_salary", "Is the candidate willing to accept a lower salary?", "radio", true, ["Yes", "No"]),
      field("interested_other_process", "Is the candidate interested in another process?", "radio", true, ["Yes", "No"]),
    ],
  },
  {
    id: "age_limit",
    name: "Age Limit",
    type: "conditional",
    fields: [
      field("date_of_birth", "Date of Birth", "date", true),
    ],
  },
  {
    id: "career_gap",
    name: "Career Gap",
    type: "conditional",
    fields: [
      field("gender", "Gender", "select", true, ["Male", "Female", "Other"]),
      field("date_of_birth", "Date of Birth", "date", true),
      field("career_gap_duration", "Career Gap Duration", "number", true),
      field("career_gap_reason", "Career Gap Reason", "select", true, [
        "Personal Reasons",
        "Health Reasons",
        "Education",
        "Family Reasons",
        "Other",
      ]),
    ],
  },
  {
    id: "no_company",
    name: "No Company",
    type: "conditional",
    fields: [
      field("reason", "Reason", "select", true, [
        "No Company Available",
        "Company Not Interested",
        "Other",
      ]),
    ],
  },
  {
    id: "voice_mail",
    name: "Voice Mail",
    type: "conditional",
    fields: [],
  },
  {
    id: "other_domain_experience",
    name: "Other Domain Experience",
    type: "conditional",
    fields: [
      field("domain", "Select Domain", "select", true, [
        "Accounts", "Finance", "Software Development", "IT Support", "Sales",
        "Marketing", "Customer Service", "Administration", "Human Resources",
        "Banking", "Insurance", "Healthcare", "Retail", "Hospitality",
        "Education", "Engineering",
      ]),
      field("interested_in_bpo", "Is the candidate interested in BPO Job?", "radio", true, ["Yes", "No"]),
    ],
  },
  {
    id: "busy_call_me_back",
    name: "Busy, Call me Back",
    type: "conditional",
    fields: [
      field("callback_date", "Callback Date", "date", true),
      field("callback_time", "Callback Time", "time", true),
      field("additional_notes", "Additional Notes", "textarea", false),
    ],
  },
  {
    id: "work_from_home",
    name: "Work from Home",
    type: "conditional",
    fields: [
      field("reason", "Reason for Work From Home Requirement", "select", true, [
        "Personal Reasons",
        "Family Reasons",
        "Travel Issues",
        "Other",
      ]),
      field("willing_to_work_from_office", "Is the candidate willing to work from office?", "radio", true, ["Yes", "No"]),
    ],
  },
  {
    id: "out_station_candidate",
    name: "Out Station Candidate",
    type: "conditional",
    fields: [
      field("candidate_location", "Candidate Current Location", "text", true),
      field("will_relocate", "Will the candidate relocate?", "radio", true, ["Yes", "No"]),
    ],
  },
  {
    id: "shift_issues",
    name: "Shift Issues",
    type: "conditional",
    fields: [
      field("shift_issue", "Shift Issue", "select", true, [
        "Night Shift",
        "Rotational Shift",
        "US Shift",
        "Transportation Issue",
        "Other",
      ]),
      field("willing_for_alternate_shift", "Is the candidate willing to work in an alternate shift?", "radio", true, ["Yes", "No"]),
    ],
  },
  {
    id: "non_hiring_university",
    name: "Non Hiring University",
    type: "conditional",
    fields: [
      field("university_name", "University Name", "text", true),
      field("company", "Which company?", "select", true, INTAKE_COMPANIES),
    ],
  },
  {
    id: "no_education_documents",
    name: "No Education Documents",
    type: "conditional",
    fields: [
      field("missing_document", "Missing Education Document", "select", true, [
        "10th Certificate",
        "12th Certificate",
        "Degree Certificate",
        "Provisional Certificate",
        "Other",
      ]),
      field("document_available_later", "Can the candidate provide the document later?", "radio", true, ["Yes", "No"]),
    ],
  },
  {
    id: "call_disconnected",
    name: "Call Disconnected",
    type: "conditional",
    fields: [
      field("seconds_spoken", "How many seconds did you speak?", "number", true),
      field("communication_judgement", "Were you able to judge communication?", "radio", true, ["Yes", "No"]),
    ],
  },
  {
    id: "cooling_period",
    name: "Cooling Period",
    type: "conditional",
    warning: "Talk to your Supervisor about this Cooling Period before proceeding. Confirm the correct duration with them — do not guess.",
    fields: [
      field("rejected_company", "Which company was the candidate rejected from?", "select", true, INTAKE_COMPANIES),
      field("rejected_round", "What round was the candidate rejected in?", "select", true, [
        "HR Round",
        "VNA Round",
        "Operation Round",
        "Test Reject",
      ]),
      field("rejected_date", "Date he was rejected", "date", true),
      field("cooling_period_duration", "Cooling Period", "select", true, [
        "1 Day Cooling Period",
        "7 Day Cooling Period",
        "15 Day Cooling Period",
        "30 Day Cooling Period",
        "45 Day Cooling Period",
        "60 Day Cooling Period",
        "90 Day Cooling Period",
      ]),
    ],
  },
  {
    id: "need_weekend_off",
    name: "Need WeekEnd Off",
    type: "conditional",
    fields: [
      field("skill_role", "Skill Role", "select", true, ["Executive / Sr Executive"]),
      field("skill", "Skill", "select", true, ["International Voice Process"]),
      field("english_communication", "English Communication (Line Up)", "radio", true, [
        "Excellent", "Very good", "Good", "Average", "Poor",
      ]),
      field("date_of_birth", "Date of Birth (Line Up)", "date", true),
      field("bpo_experience", "BPO Experience", "select", true, ["FRESHER", "EXPERIENCED"]),
      field("qualification", "Qualification", "select", true, ["Graduate"]),
      field("shift_base", "Shift Base", "select", true, ["US Shift"]),
      field("dnd", "DND", "select", true, ["Activate", "Deactivate"]),
    ],
  },
  {
    id: "other_recruiter",
    name: "Other Recruiter",
    type: "conditional",
    fields: [
      field("recruiter", "Select Recruiter", "select", true, []),
      field("additional_notes", "Additional Notes", "textarea", false),
    ],
  },
  {
    id: "no_experience_documents",
    name: "No Experience Documents",
    type: "conditional",
    fields: [
      field("document_type", "Which experience document is missing?", "select", true, [
        "Experience Letter",
        "Relieving Letter",
        "Salary Slips",
        "Other",
      ]),
      field("document_remarks", "Remarks", "textarea", false),
    ],
  },
  {
    id: "serving_notice",
    name: "Serving Notice",
    type: "conditional",
    fields: [
      field("notice_period", "Notice Period", "select", true, [
        "15 Days",
        "30 Days",
        "45 Days",
        "60 Days",
        "90 Days",
        "Other",
      ]),
      field("last_working_day", "Last Working Day", "date", true),
      field("notice_remarks", "Remarks", "textarea", false),
    ],
  },
  {
    id: "line_up_scheduled",
    name: "Line Up Scheduled",
    type: "conditional",
    fields: [
      field("scheduled_date", "Scheduled Date", "date", true),
      field("scheduled_time", "Scheduled Time", "time", true),
      field("scheduled_round", "Interview Round", "select", true, [
        "HR Round",
        "Operations Round",
        "Assessment",
        "Final Round",
        "Other",
      ]),
      field("schedule_remarks", "Remarks", "textarea", false),
    ],
  },
];

/**
 * When each outcome actually applies. This is the client's own wording and it
 * is what the agent reasons over mid-call, so the distinctions matter — several
 * outcomes look interchangeable until you read where the line sits (No Company
 * is "nothing matches", not "we rejected them"; Career Gap needs the gap to
 * actually breach a JD, not merely exist).
 */
export const DISPOSITION_MEANINGS: Record<string, string> = {
  poor_communication:
    "Communication ability does not meet the minimum for the available voice processes — trouble understanding questions, forming understandable sentences, or holding the required level of English.",
  non_hiring_zone:
    "Candidate lives in, or wants to work from, a location outside the hiring/serviceable locations for the available JDs.",
  not_interested:
    "Candidate understood the opportunity and clearly said they do not want to proceed.",
  high_salary:
    "Minimum expected salary is above the maximum CTC across suitable openings and they will not accept the offered range.",
  age_limit:
    "Candidate does not meet a job's stated age eligibility. Use only where that requirement is lawful and genuinely applies to that opening.",
  career_gap:
    "An employment or education gap makes them ineligible under that client's criteria. Do not use just because a gap exists — only when it actually breaches the JD.",
  no_company:
    "No currently available JD matches their profile, eligibility, preferences or location. This is not a rejection; they can be revisited when a suitable JD opens.",
  voice_mail:
    "The call reached voicemail or an automated mailbox instead of the candidate. Make no assessment of the candidate.",
  other_domain_experience:
    "Their experience is mainly in another domain and does not meet the relevant experience requirement of the available openings.",
  busy_call_me_back:
    "Candidate answered but cannot speak now and asked to be called again. Always capture a callback date and time.",
  work_from_home:
    "Candidate specifically wants remote/WFH while the suitable openings require office or hybrid attendance.",
  out_station_candidate:
    "Candidate is outside the hiring city/region and cannot or will not relocate as required.",
  shift_issues:
    "Otherwise potentially eligible, but cannot work the required shift — US, night, rotational and so on.",
  non_hiring_university:
    "Their institution is not accepted under that client's documented hiring criteria. Use only against explicit client rules, never recruiter judgement.",
  no_education_documents:
    "Candidate cannot currently provide the educational documents needed for verification or onboarding.",
  no_experience_documents:
    "Candidate claims prior experience but cannot provide the proof required — experience letter, relieving letter, payslips.",
  serving_notice:
    "Currently employed and serving notice, so they cannot join inside the required joining timeline. This is a hold, not a rejection.",
  line_up_scheduled:
    "Candidate passed initial screening and has been scheduled for the next step — interview, assessment, walk-in or HR round.",
  call_disconnected:
    "The call dropped before screening could be completed. This should lead to a retry, not a rejection.",
  cooling_period:
    "Candidate previously applied or interviewed with the same client and must wait out that client's cooling period before reapplying.",
  need_weekend_off:
    "Candidate needs a fixed weekend off, but the suitable opening has rotational week-offs or needs weekend availability.",
  other_recruiter:
    "Another recruiter or consultancy is already handling this candidate for the same opportunity — duplicate/ownership conflict.",
};

const BY_ID = new Map(INTAKE_DISPOSITIONS.map((d) => [d.id, d]));

export function getIntakeDisposition(id: string | null | undefined): IntakeDisposition | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}

function isAnswerValue(v: unknown): v is string | number | null {
  return typeof v === "string" || typeof v === "number" || v === null;
}

function parseEnglishRead(raw: unknown): IntakeEnglishRead | null {
  if (!isRecord(raw)) return null;
  const rating = raw["rating"];
  if (!ENGLISH_RATINGS.includes(rating as IntakeEnglishRead["rating"])) return null;
  const confidence = Number(raw["confidence"]);
  return {
    rating: rating as IntakeEnglishRead["rating"],
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
    evidence: Array.isArray(raw["evidence"])
      ? raw["evidence"].filter((e): e is string => typeof e === "string").slice(-8)
      : [],
    samples: Number.isFinite(Number(raw["samples"])) ? Number(raw["samples"]) : 0,
  };
}

export const ENGLISH_RATINGS = ["Excellent", "Very good", "Good", "Average", "Poor"] as const;

function parseScreen(raw: unknown): IntakeScreen | null {
  if (!isRecord(raw)) return null;
  const screen: IntakeScreen = {};
  const keys = [
    "servingNotice", "wantsWfh", "needsWeekendOff", "hasCareerGap",
    "otherDomain", "missingEduDocs", "missingExpDocs",
  ] as const;
  let any = false;
  for (const key of keys) {
    const v = raw[key];
    if (v === "yes" || v === "no") {
      screen[key] = v;
      any = true;
    }
  }
  const pin = String(raw["pincode"] ?? "").replace(/\D/g, "");
  if (/^[1-8]\d{5}$/.test(pin)) {
    screen.pincode = pin;
    any = true;
  }
  const lastCompany = String(raw["lastCompany"] ?? "").replace(/\s+/g, " ").trim();
  if (lastCompany) {
    screen.lastCompany = lastCompany.slice(0, 80);
    any = true;
  }
  const tenure = String(raw["tenure"] ?? "").replace(/\s+/g, " ").trim();
  if (tenure) {
    screen.tenure = tenure.slice(0, 40);
    any = true;
  }
  return any ? screen : null;
}

/**
 * Reads `extra` in either shape. Rows written before multi-disposition have a
 * single `dispositionId` and flat `answers`; those are lifted into the list
 * form here so old forms keep rendering.
 */
export function parseIntakeExtra(raw: unknown): IntakeExtra {
  if (!isRecord(raw)) return { dispositionIds: [], answers: {} };
  const rec = raw;

  const dispositionIds: string[] = [];
  if (Array.isArray(rec["dispositionIds"])) {
    for (const id of rec["dispositionIds"]) {
      if (typeof id === "string" && BY_ID.has(id) && !dispositionIds.includes(id)) dispositionIds.push(id);
    }
  } else if (typeof rec["dispositionId"] === "string" && BY_ID.has(rec["dispositionId"])) {
    dispositionIds.push(rec["dispositionId"]);
  }

  const answers: Record<string, Record<string, string | number | null>> = {};
  const rawAnswers = rec["answers"];
  if (isRecord(rawAnswers)) {
    const nested = Object.values(rawAnswers).some(isRecord);
    if (nested) {
      for (const [dispId, values] of Object.entries(rawAnswers)) {
        if (!isRecord(values)) continue;
        const bucket: Record<string, string | number | null> = {};
        for (const [k, v] of Object.entries(values)) if (isAnswerValue(v)) bucket[k] = v;
        answers[dispId] = bucket;
      }
    } else if (dispositionIds[0]) {
      // Legacy flat answers belonged to the single stored disposition.
      const bucket: Record<string, string | number | null> = {};
      for (const [k, v] of Object.entries(rawAnswers)) if (isAnswerValue(v)) bucket[k] = v;
      answers[dispositionIds[0]] = bucket;
    }
  }

  return {
    dispositionIds,
    answers,
    english: parseEnglishRead(rec["english"]),
    screen: parseScreen(rec["screen"]),
    match: isRecord(rec["match"]) ? rec["match"] : rec["match"] === null ? null : undefined,
  };
}

/** Primary outcome — the first one recorded. Used where one label is needed. */
export function primaryDispositionId(extra: IntakeExtra): string | null {
  return extra.dispositionIds[0] ?? null;
}

/** Answers for one outcome, or an empty object. */
export function dispositionAnswers(
  extra: IntakeExtra,
  dispositionId: string,
): Record<string, string | number | null> {
  return extra.answers[dispositionId] ?? {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collapse(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function matchOption(raw: string, options: readonly string[]): string | null {
  const exact = options.find((o) => o === raw);
  if (exact) return exact;
  const want = slug(raw);
  if (!want) return null;
  return options.find((o) => slug(o) === want) ?? null;
}

const NOTICE_DAY_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, a: 1, an: 1,
  fifteen: 15, thirty: 30, sixty: 60, ninety: 90,
};

function noticeSpokenNumber(raw: string): number | null {
  if (NOTICE_DAY_WORDS[raw] != null) return NOTICE_DAY_WORDS[raw]!;
  if (/^forty[\s-]*five$/.test(raw)) return 45;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Map "30 days" / "one month" onto the serving-notice dropdown. */
export function parseNoticePeriodSelect(raw: unknown, options: readonly string[]): string | null {
  const text = collapse(raw);
  if (!text) return null;
  const matched = matchOption(text, options);
  if (matched) return matched;
  const lower = text.toLowerCase().replace(/,/g, " ");
  if (/\bother\b/.test(lower)) return options.find((o) => slug(o) === "other") ?? null;

  let days: number | null = null;
  const monthHit = lower.match(/\b(\d+(?:\.\d+)?|one|two|three|a|an)\s*months?\b/);
  if (monthHit) {
    const n = noticeSpokenNumber(monthHit[1]!);
    if (n != null) days = Math.round(n * 30);
  }
  if (days == null) {
    const dayHit = lower.match(/\b(\d+(?:\.\d+)?)\s*days?\b/)
      ?? lower.match(/\b(fifteen|thirty|forty[\s-]*five|sixty|ninety)\s*(?:days?)?\b/);
    if (dayHit) days = noticeSpokenNumber(dayHit[1]!.replace(/\s+/g, " "));
  }
  if (days == null) return null;
  if (days <= 15) return matchOption("15 Days", options);
  if (days <= 30) return matchOption("30 Days", options);
  if (days <= 45) return matchOption("45 Days", options);
  if (days <= 60) return matchOption("60 Days", options);
  if (days <= 90) return matchOption("90 Days", options);
  return matchOption("Other", options);
}

/** Calendar date for a spoken day-of-month like "28" / "the 28th" — this month if still upcoming, else next. */
export function upcomingIsoFromDayOfMonth(day: number): string | null {
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  const today = `${year}-${String(month).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const thisMonth = isoDate(year, month, day);
  if (thisMonth && thisMonth >= today) return thisMonth;
  month += 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return isoDate(year, month, day);
}

/** Today plus N calendar days, as YYYY-MM-DD in local time. */
export function addCalendarDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function noticePeriodLengthDays(label: string): number | null {
  const m = String(label ?? "").match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function parseDate(raw: unknown, kind: "birth" | "any"): { ok: true; value: string } | { ok: false; error: string } {
  const text = collapse(raw).replace(/(\d+)(st|nd|rd|th)\b/gi, "$1");
  const ymd = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const dmy = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  const dMonY = text.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/);
  const monDY = text.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  let out: string | null = null;
  const dayOnly = kind === "any" ? text.match(/^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?$/) : null;
  if (dayOnly) out = upcomingIsoFromDayOfMonth(Number(dayOnly[1]));
  else if (ymd) out = isoDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  else if (dmy) out = isoDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  else if (dMonY) {
    const w = dMonY[2]!.toLowerCase();
    const month = MONTHS.findIndex((m) => m === w || m.slice(0, 3) === w.slice(0, 3)) + 1;
    out = month > 0 ? isoDate(Number(dMonY[3]), month, Number(dMonY[1])) : null;
  } else if (monDY) {
    const w = monDY[1]!.toLowerCase();
    const month = MONTHS.findIndex((m) => m === w || m.slice(0, 3) === w.slice(0, 3)) + 1;
    out = month > 0 ? isoDate(Number(monDY[3]), month, Number(monDY[2])) : null;
  }
  if (!out) return { ok: false, error: "Date must look like 20/07/2000" };
  const today = new Date().toISOString().slice(0, 10);
  if (kind === "birth") {
    if (out >= today) return { ok: false, error: "Date of birth cannot be in the future" };
    if (Number(out.slice(0, 4)) < 1925) return { ok: false, error: "Date of birth year is not plausible" };
  }
  return { ok: true, value: out };
}

function parseTime(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const text = collapse(raw).toLowerCase();
  const h24 = text.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (h24) return { ok: true, value: `${h24[1]!.padStart(2, "0")}:${h24[2]}` };
  // Minutes optional — an on-the-hour appointment is spoken as "ten am", and
  // the model passes it straight through without a ":00".
  const h12 = text.match(/^([1-9]|1[0-2])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)$/);
  if (h12) {
    let hour = Number(h12[1]);
    const meridiem = h12[3]!.replace(/\./g, "");
    if (meridiem === "am" && hour === 12) hour = 0;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    return { ok: true, value: `${String(hour).padStart(2, "0")}:${h12[2] ?? "00"}` };
  }
  return { ok: false, error: "Time must look like 15:30 or 3:30 pm" };
}

function parseNumber(raw: unknown, label: string): { ok: true; value: number } | { ok: false; error: string } {
  const text = collapse(raw).replace(/,/g, "");
  const n = Number(text);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: `${label} must be a whole number` };
  if (n < 0 || n > 99_999_999) return { ok: false, error: `${label} is out of range` };
  return { ok: true, value: n };
}

function normalizeFieldValue(
  spec: IntakeDispositionField,
  raw: unknown,
): { ok: true; value: string | number | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || collapse(raw) === "") {
    return { ok: true, value: null };
  }
  if (spec.type === "number") return parseNumber(raw, spec.label);
  if (spec.type === "date") {
    return parseDate(raw, spec.id === "date_of_birth" ? "birth" : "any");
  }
  if (spec.type === "time") return parseTime(raw);
  if ((spec.type === "select" || spec.type === "radio") && spec.options && spec.options.length > 0) {
    const matched = spec.id === "notice_period"
      ? parseNoticePeriodSelect(raw, spec.options)
      : matchOption(collapse(raw), spec.options);
    if (!matched) return { ok: false, error: `${spec.label} is not a valid option` };
    return { ok: true, value: matched };
  }
  const text = collapse(raw);
  if (text.length > 2000) return { ok: false, error: `${spec.label} is too long` };
  return { ok: true, value: text };
}

/** Selects whose JSON listed no options are filled as free text. */
export function dispositionFieldIsFreeText(spec: IntakeDispositionField): boolean {
  return spec.type === "text"
    || spec.type === "textarea"
    || ((spec.type === "select") && (!spec.options || spec.options.length === 0));
}

/** Accepts an id, the display name, or a loose spoken variant of either. */
function resolveDisposition(raw: unknown): IntakeDisposition | null {
  const text = collapse(raw);
  if (!text) return null;
  return getIntakeDisposition(text)
    ?? INTAKE_DISPOSITIONS.find((d) => slug(d.name) === slug(text))
    ?? INTAKE_DISPOSITIONS.find((d) => slug(d.id) === slug(text))
    ?? null;
}

const SCREEN_INPUT_KEYS = new Set([
  "servingNotice", "wantsWfh", "needsWeekendOff", "hasCareerGap",
  "otherDomain", "missingEduDocs", "missingExpDocs",
  "pincode", "pinCode", "pin",
  "lastCompany", "companyName", "currentCompany",
  "tenure", "tenureYears", "workingTenure",
]);

/**
 * The model often sends `work_from_home: '{"reason":"..."}'` instead of
 * `disposition` plus dotted keys. Expand a disposition-id key into
 * `disposition` and `<id>.<field>` answers when the value is an object or a
 * JSON object string.
 */
export function expandDispositionToolArgs(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const implied: string[] = [];
  for (const [key, raw] of Object.entries(input)) {
    if (key === "disposition" || key === "dispositionId" || key === "dispositions") {
      out[key] = raw;
      continue;
    }
    if (SCREEN_INPUT_KEYS.has(key) || key.includes(".")) {
      out[key] = raw;
      continue;
    }
    const spec = resolveDisposition(key);
    if (!spec) {
      out[key] = raw;
      continue;
    }
    implied.push(spec.id);
    const nested = parseDispositionAnswerObject(raw);
    if (nested) {
      for (const [fieldId, value] of Object.entries(nested)) {
        out[`${spec.id}.${fieldId}`] = value;
      }
    }
  }
  if (
    implied.length > 0
    && out["disposition"] === undefined
    && out["dispositionId"] === undefined
    && out["dispositions"] === undefined
  ) {
    out["disposition"] = implied[0]!;
  }
  return out;
}

function parseDispositionAnswerObject(raw: unknown): Record<string, unknown> | null {
  if (isRecord(raw)) return raw;
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Applies one outcome and its answers.
 *
 * `disposition` may be a single id (added to the list) or an array (replaces
 * the list). Remaining keys are answers for the outcome named in this same
 * patch — or, when none is named, for the only outcome on the form. Written
 * keys come back namespaced (`not_interested.reason`) so two outcomes sharing
 * a field id never collide.
 */
export function applyDispositionPatch(
  current: IntakeExtra,
  input: Record<string, unknown>,
): DispositionPatchResult {
  input = expandDispositionToolArgs(input);
  const errors: Array<{ field: string; message: string }> = [];
  const written: string[] = [];
  let dispositionIds = [...current.dispositionIds];
  const answers: Record<string, Record<string, string | number | null>> = {};
  for (const [k, v] of Object.entries(current.answers)) answers[k] = { ...v };

  /** The outcome that the loose answer keys in this patch belong to. */
  let target: IntakeDisposition | null = null;

  const rawDisposition = "disposition" in input ? input["disposition"]
    : "dispositionId" in input ? input["dispositionId"]
    : "dispositions" in input ? input["dispositions"]
    : undefined;

  if (rawDisposition !== undefined) {
    if (rawDisposition === null || (!Array.isArray(rawDisposition) && collapse(rawDisposition) === "")) {
      dispositionIds = [];
      for (const key of Object.keys(answers)) delete answers[key];
      written.push("disposition");
    } else if (Array.isArray(rawDisposition)) {
      const next: string[] = [];
      for (const entry of rawDisposition) {
        const matched = resolveDisposition(entry);
        if (!matched) {
          errors.push({ field: "disposition", message: `Unknown disposition "${collapse(entry)}"` });
          continue;
        }
        if (!next.includes(matched.id)) next.push(matched.id);
      }
      for (const key of Object.keys(answers)) if (!next.includes(key)) delete answers[key];
      dispositionIds = next;
      target = next.length === 1 ? getIntakeDisposition(next[0]!) : null;
      written.push("disposition");
    } else {
      const matched = resolveDisposition(rawDisposition);
      if (!matched) {
        errors.push({ field: "disposition", message: `Unknown disposition "${collapse(rawDisposition)}"` });
      } else {
        if (!dispositionIds.includes(matched.id)) {
          dispositionIds.push(matched.id);
          written.push("disposition");
        }
        target = matched;
      }
    }
  }

  if (!target && dispositionIds.length === 1) target = getIntakeDisposition(dispositionIds[0]!);

  for (const [key, raw] of Object.entries(input)) {
    if (key === "disposition" || key === "dispositionId" || key === "dispositions") continue;
    if (SCREEN_INPUT_KEYS.has(key)) continue;

    // `not_interested.reason` addresses one outcome explicitly; bare `reason`
    // falls back to the outcome this patch is about.
    const dot = key.indexOf(".");
    const explicit = dot > 0 ? getIntakeDisposition(key.slice(0, dot)) : null;
    const spec = explicit ?? target;
    const fieldId = explicit ? key.slice(dot + 1) : key;

    if (!spec) {
      errors.push({
        field: key,
        message: dispositionIds.length === 0
          ? "Record an outcome before answering its questions"
          : "Say which outcome this answer belongs to",
      });
      continue;
    }
    if (!dispositionIds.includes(spec.id)) {
      errors.push({ field: key, message: `${spec.name} is not one of the recorded outcomes` });
      continue;
    }
    const fieldSpec = spec.fields.find((f) => f.id === fieldId);
    if (!fieldSpec) {
      errors.push({ field: key, message: `Unknown field for ${spec.name}` });
      continue;
    }
    const result = normalizeFieldValue(fieldSpec, raw);
    if (!result.ok) {
      errors.push({ field: key, message: result.error });
      continue;
    }
    answers[spec.id] = { ...(answers[spec.id] ?? {}), [fieldId]: result.value };
    written.push(`${spec.id}.${fieldId}`);
  }

  return { extra: { ...current, dispositionIds, answers }, written, errors };
}

/** Unanswered required fields across every recorded outcome, namespaced. */
export function missingDispositionFields(extra: IntakeExtra): string[] {
  const missing: string[] = [];
  for (const id of extra.dispositionIds) {
    const spec = getIntakeDisposition(id);
    if (!spec) continue;
    const answered = extra.answers[id] ?? {};
    for (const f of spec.fields) {
      if (!f.required) continue;
      const v = answered[f.id];
      if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) {
        missing.push(`${id}.${f.id}`);
      }
    }
  }
  return missing;
}

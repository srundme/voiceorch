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

export interface IntakeExtra {
  dispositionId: string | null;
  answers: Record<string, string | number | null>;
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
];

const BY_ID = new Map(INTAKE_DISPOSITIONS.map((d) => [d.id, d]));

export function getIntakeDisposition(id: string | null | undefined): IntakeDisposition | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}

export function parseIntakeExtra(raw: unknown): IntakeExtra {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { dispositionId: null, answers: {} };
  }
  const rec = raw as Record<string, unknown>;
  const dispositionId = typeof rec.dispositionId === "string" && BY_ID.has(rec.dispositionId)
    ? rec.dispositionId
    : null;
  const answers: Record<string, string | number | null> = {};
  if (rec.answers && typeof rec.answers === "object" && !Array.isArray(rec.answers)) {
    for (const [key, value] of Object.entries(rec.answers as Record<string, unknown>)) {
      if (typeof value === "string" || typeof value === "number" || value === null) {
        answers[key] = value;
      }
    }
  }
  return { dispositionId, answers, match: isRecord(rec.match) ? rec.match : rec.match === null ? null : undefined };
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
  if (ymd) out = isoDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
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
  const h12 = text.match(/^([1-9]|1[0-2]):([0-5]\d)\s*(am|pm)$/);
  if (h12) {
    let hour = Number(h12[1]);
    const mer = h12[3];
    if (mer === "am" && hour === 12) hour = 0;
    if (mer === "pm" && hour !== 12) hour += 12;
    return { ok: true, value: `${String(hour).padStart(2, "0")}:${h12[2]}` };
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
    const matched = matchOption(collapse(raw), spec.options);
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

export function applyDispositionPatch(
  current: IntakeExtra,
  input: Record<string, unknown>,
): DispositionPatchResult {
  const errors: Array<{ field: string; message: string }> = [];
  const written: string[] = [];
  let dispositionId = current.dispositionId;
  let answers = { ...current.answers };

  if ("disposition" in input || "dispositionId" in input) {
    const raw = input["disposition"] ?? input["dispositionId"];
    if (raw === null || collapse(raw) === "") {
      dispositionId = null;
      answers = {};
      written.push("disposition");
    } else {
      const matched = getIntakeDisposition(collapse(raw))
        ?? INTAKE_DISPOSITIONS.find((d) => slug(d.name) === slug(collapse(raw)))
        ?? null;
      if (!matched) {
        errors.push({ field: "disposition", message: "Unknown disposition" });
      } else {
        if (matched.id !== dispositionId) answers = {};
        dispositionId = matched.id;
        written.push("disposition");
      }
    }
  }

  const spec = getIntakeDisposition(dispositionId);
  const known = new Set(spec?.fields.map((f) => f.id) ?? []);

  for (const [key, raw] of Object.entries(input)) {
    if (key === "disposition" || key === "dispositionId") continue;
    if (!spec || !known.has(key)) {
      errors.push({ field: key, message: dispositionId ? "Unknown field for this disposition" : "Select a disposition first" });
      continue;
    }
    const fieldSpec = spec.fields.find((f) => f.id === key)!;
    const result = normalizeFieldValue(fieldSpec, raw);
    if (!result.ok) {
      errors.push({ field: key, message: result.error });
      continue;
    }
    answers[key] = result.value;
    written.push(key);
  }

  return { extra: { ...current, dispositionId, answers }, written, errors };
}

export function missingDispositionFields(extra: IntakeExtra): string[] {
  const spec = getIntakeDisposition(extra.dispositionId);
  if (!spec) return extra.dispositionId ? [] : [];
  return spec.fields
    .filter((f) => f.required)
    .filter((f) => {
      const v = extra.answers[f.id];
      return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
    })
    .map((f) => f.id);
}

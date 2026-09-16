/**
 * Shape + option lists for the live candidate intake form.
 *
 * Mirrors `api-server/src/lib/candidate-intake-fields.ts`. Kept separate from
 * the page so the option lists and progress maths stay unit-testable.
 */

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

/** Asked on the call. English communication is scored after the call ends. */
export const INTAKE_REQUIRED_ON_CALL: readonly IntakeFieldKey[] = [
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
  "qualification",
  "shiftBase",
];

export interface IntakeDto {
  token: string;
  status: "in_progress" | "completed";
  revision: number;
  lastFieldKey: string | null;
  lastWriteSource: "agent" | "human" | null;
  agentId: number | null;
  callId: number | null;
  fields: Record<IntakeFieldKey, string | number | null>;
  missingFields: IntakeFieldKey[];
  dispositionId: string | null;
  dispositionAnswers: Record<string, string | number | null>;
  missingDispositionFields: string[];
  updatedAt: string;
  createdAt: string;
}

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

export interface IntakeOption {
  value: string;
  label: string;
}

export const GENDER_OPTIONS: readonly IntakeOption[] = [
  { value: "MALE", label: "Male" },
  { value: "FEMALE", label: "Female" },
  { value: "OTHER", label: "Other" },
];

export const WORK_STATUS_OPTIONS: readonly IntakeOption[] = [
  { value: "FRESHER", label: "FRESHER" },
  { value: "EXPERIENCED", label: "EXPERIENCED" },
];

export const ENGLISH_OPTIONS: readonly IntakeOption[] = [
  { value: "EXCELLENT", label: "Excellent" },
  { value: "VERY_GOOD", label: "Very good" },
  { value: "GOOD", label: "Good" },
  { value: "AVERAGE", label: "Average" },
  { value: "POOR", label: "Poor" },
];

export const SKILL_ROLE_OPTIONS: readonly IntakeOption[] = [
  { value: "EXECUTIVE_SR_EXECUTIVE", label: "Executive / Sr Executive" },
];

export const SKILL_OPTIONS: readonly IntakeOption[] = [
  { value: "INTERNATIONAL_VOICE_PROCESS", label: "International Voice Process" },
];

export const INDUSTRY_OPTIONS: readonly IntakeOption[] = [
  { value: "BPO_CALL_CENTER", label: "BPO / Call Center" },
];

export const QUALIFICATION_OPTIONS: readonly IntakeOption[] = [
  { value: "GRADUATE", label: "Graduate" },
  { value: "POST_GRADUATE", label: "Post Graduation" },
];

export const SHIFT_BASE_OPTIONS: readonly IntakeOption[] = [
  { value: "ANY", label: "Any shift" },
  { value: "DAY_ONLY", label: "Day shift only" },
  { value: "NIGHT_ONLY", label: "Night shift only" },
  { value: "UK", label: "UK Shift" },
  { value: "US", label: "US Shift" },
  { value: "AUS", label: "AUS Shift" },
  { value: "DOMESTIC", label: "Domestic Shift" },
  { value: "ROTATIONAL", label: "Rotational" },
];

export const DND_OPTIONS: readonly IntakeOption[] = [
  { value: "DEACTIVATE", label: "Deactivate" },
  { value: "ACTIVATE", label: "Activate" },
];

export const CITY_OPTIONS: readonly string[] = [
  "AHMEDABAD",
  "BENGALURU",
  "BHOPAL",
  "BHUBANESWAR",
  "CHANDIGARH",
  "CHENNAI",
  "COIMBATORE",
  "DEHRADUN",
  "DELHI",
  "FARIDABAD",
  "GHAZIABAD",
  "GURUGRAM",
  "GUWAHATI",
  "HYDERABAD",
  "INDORE",
  "JAIPUR",
  "KANPUR",
  "KOCHI",
  "KOLKATA",
  "LUCKNOW",
  "LUDHIANA",
  "MADURAI",
  "MUMBAI",
  "MYSURU",
  "NAGPUR",
  "NASHIK",
  "NOIDA",
  "PATNA",
  "PUNE",
  "RAIPUR",
  "RANCHI",
  "SURAT",
  "THIRUVANANTHAPURAM",
  "TIRUCHIRAPPALLI",
  "VADODARA",
  "VARANASI",
  "VIJAYAWADA",
  "VISAKHAPATNAM",
];

/**
 * The agent can capture a city that is not on the list — a dropdown that
 * silently drops it would look like a lost answer, so fold it in.
 */
export function cityOptionsWith(value: string | number | null): string[] {
  const current = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!current || CITY_OPTIONS.includes(current)) return [...CITY_OPTIONS];
  return [current, ...CITY_OPTIONS];
}

export function isFieldFilled(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return true;
  return value.trim() !== "";
}

/** How much of the call questionnaire the agent has captured so far. */
export function intakeProgress(
  fields: Partial<Record<IntakeFieldKey, string | number | null>>,
  disposition?: {
    requiredIds: readonly string[];
    answers: Record<string, string | number | null>;
  },
): { filled: number; total: number } {
  const filled = INTAKE_REQUIRED_ON_CALL.filter((key) => isFieldFilled(fields[key])).length;
  if (!disposition) return { filled, total: INTAKE_REQUIRED_ON_CALL.length };
  const extraFilled = disposition.requiredIds.filter((id) => isFieldFilled(disposition.answers[id] ?? null)).length;
  return {
    filled: filled + extraFilled,
    total: INTAKE_REQUIRED_ON_CALL.length + disposition.requiredIds.length,
  };
}

/** Stored dates are ISO (YYYY-MM-DD); the client's form reads dd/mm/yyyy. */
export function formatDobForDisplay(iso: string | number | null): string {
  if (typeof iso !== "string") return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function fieldToInputValue(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

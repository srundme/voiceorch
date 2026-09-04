/**
 * Shared prompt-variable resolution.
 *
 * Substitutes `{{key}}` / `{key}` placeholders in a string using the supplied
 * variable map. Used for BOTH the system prompt and the static greeting so the
 * two share one implementation and the same precedence order.
 *
 * Special case: `caller_salutation` is intentionally left untouched (passed
 * through verbatim) because it is resolved mid-call by gender detection, not at
 * session/greeting start. Unknown tags are also left untouched (not blanked).
 */

const LEAD_CONTEXT_SYSTEM_FIELDS = new Set([
  "to_number", "from_number", "agent_name", "caller_number", "date",
]);

/** Internal bookkeeping keys — never show these to the LLM. */
const LEAD_CONTEXT_INTERNAL_PREFIX = "__";

/** Alias keys that duplicate `name` / `email` / `phone` when values match. */
const LEAD_CONTEXT_ALIAS_OF: Record<string, string> = {
  caller_name: "name",
  customer_name: "name",
  customer_email: "email",
  caller_email: "email",
  caller_phone: "phone",
  customer_phone: "phone",
};

const LEAD_CONTEXT_KNOWN_LABELS: Record<string, string> = {
  name:    "Name",
  patient_name: "Patient Name",
  category: "Category",
  phone:   "Phone",
  email:   "Email",
  city:    "City",
  age:     "Age",
  gender:  "Gender",
  company: "Company",
  country: "Country",
  state:   "State",
};

function titleCaseKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Builds a structured lead context block to prepend to the system prompt for
 * campaign / Automatic Calls. Skips system-level fields, internal `__*` keys,
 * empty values, and redundant name/email aliases.
 *
 * Includes an explicit do-not-re-ask directive so scripted agent prompts that
 * still say "ask for their name" do not override known sheet/CRM fields.
 */
export function buildLeadContextBlock(
  campaignLeadVars: Record<string, string>,
): string {
  const lines: string[] = [];
  const knownName = (campaignLeadVars["name"] ?? "").trim();

  for (const [key, value] of Object.entries(campaignLeadVars)) {
    if (LEAD_CONTEXT_SYSTEM_FIELDS.has(key)) continue;
    if (key.startsWith(LEAD_CONTEXT_INTERNAL_PREFIX)) continue;
    if (!value || !value.trim()) continue;

    const aliasOf = LEAD_CONTEXT_ALIAS_OF[key];
    if (aliasOf) {
      const primary = (campaignLeadVars[aliasOf] ?? "").trim();
      if (primary && primary.toLowerCase() === value.trim().toLowerCase()) continue;
    }

    const label = LEAD_CONTEXT_KNOWN_LABELS[key] ?? titleCaseKey(key);
    lines.push(`${label}: ${value.trim()}`);
  }
  if (lines.length === 0) return "";

  const directive = knownName
    ? `Known lead fields for this caller (name is ${knownName}).`
    : `Known lead fields for this caller.`;

  return `=== LEAD CONTEXT ===\n${lines.join("\n")}\n\n${directive}\n===================`;
}

const CALL_VAR_MAX_KEYS = 40;
const CALL_VAR_MAX_KEY_LEN = 64;
const CALL_VAR_MAX_VALUE = 8000;
const QUESTIONS_KEYS = new Set(["questions", "question_list", "script_questions"]);

function sanitizeVarKey(raw: string): string {
  return raw.trim().replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "").slice(0, CALL_VAR_MAX_KEY_LEN);
}

function stringifyVarValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim().slice(0, CALL_VAR_MAX_VALUE);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    const items = value
      .map((item) => stringifyVarValue(item))
      .filter(Boolean)
      .slice(0, 80);
    return items.map((item, i) => `${i + 1}. ${item}`).join("\n").slice(0, CALL_VAR_MAX_VALUE);
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value).slice(0, CALL_VAR_MAX_VALUE);
    } catch {
      return "";
    }
  }
  return "";
}

/**
 * Flatten a CRM/API bag into string prompt variables.
 * Arrays (e.g. questions) become a numbered list.
 */
export function normalizeCallVariables(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [rawKey, rawVal] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(out).length >= CALL_VAR_MAX_KEYS) break;
    const key = sanitizeVarKey(rawKey);
    if (!key) continue;
    const value = stringifyVarValue(rawVal);
    if (!value) continue;
    out[key] = value;
  }
  return out;
}

/** Read variables stored on a call row at dial time (`metadata.callVariables`). */
export function callVariablesFromMetadata(meta: Record<string, unknown> | null | undefined): Record<string, string> {
  if (!meta) return {};
  const raw = meta["callVariables"] ?? meta["variables"] ?? meta["parameters"];
  return normalizeCallVariables(raw);
}

/**
 * Per-call context for API outbound (hospital CRM, dynamic questionnaires).
 * Injected even when the agent prompt has no {{placeholders}}.
 */
export function buildCallContextBlock(vars: Record<string, string>): string {
  const questionsKey = Object.keys(vars).find((k) => QUESTIONS_KEYS.has(k) && vars[k]?.trim());
  const questions = questionsKey ? vars[questionsKey]!.trim() : "";
  const rest: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (QUESTIONS_KEYS.has(k)) continue;
    rest[k] = v;
  }

  const fieldBlock = buildLeadContextBlock(rest);
  const fieldLines = fieldBlock
    ? fieldBlock
        .replace(/^=== LEAD CONTEXT ===\n/, "")
        .replace(/\n\nDIRECTIVE[\s\S]*/, "")
        .replace(/\n={3,}\s*$/, "")
        .trim()
    : "";

  if (!fieldLines && !questions) return "";

  const parts: string[] = ["=== THIS CALL ==="];
  if (fieldLines) parts.push(fieldLines);
  if (questions) {
    parts.push("");
    parts.push("Questions to ask (in order — wait for an answer after each):");
    parts.push(questions);
  }
  parts.push("");
  parts.push(
    "DIRECTIVE (this call only): Use the fields above. " +
      (questions
        ? "Ask every listed question; do not skip or invent extra questionnaire items. "
        : "") +
      "Do NOT re-ask a field that is already listed unless the patient corrects you.",
  );
  parts.push("===================");
  return parts.join("\n");
}

export function resolvePromptVariables(
  text: string,
  vars: Record<string, string>,
): string {
  const resolveVar = (key: string, fullMatch: string): string => {
    if (key === "caller_salutation") return fullMatch;
    return key in vars ? vars[key]! : fullMatch;
  };
  return text
    .replace(/\{\{(\w+)\}\}/g, (m, k: string) => resolveVar(k, m))
    .replace(/\{(\w+)\}/g, (m, k: string) => resolveVar(k, m));
}

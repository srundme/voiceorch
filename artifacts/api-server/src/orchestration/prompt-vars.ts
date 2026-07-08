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

const LEAD_CONTEXT_KNOWN_LABELS: Record<string, string> = {
  name:    "Name",
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
 * campaign calls. Skips system-level fields and empty/blank values.
 * Returns an empty string when there are no displayable lead fields.
 */
export function buildLeadContextBlock(
  campaignLeadVars: Record<string, string>,
): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(campaignLeadVars)) {
    if (LEAD_CONTEXT_SYSTEM_FIELDS.has(key)) continue;
    if (!value || !value.trim()) continue;
    const label = LEAD_CONTEXT_KNOWN_LABELS[key] ?? titleCaseKey(key);
    lines.push(`${label}: ${value.trim()}`);
  }
  if (lines.length === 0) return "";
  return `=== LEAD CONTEXT ===\n${lines.join("\n")}\n===================`;
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

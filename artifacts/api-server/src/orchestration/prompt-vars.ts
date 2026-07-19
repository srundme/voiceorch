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
    ? `DIRECTIVE (overrides any "ask for name" steps in the script below): ` +
      `You already know this caller's name is ${knownName}. Greet and address them as ${knownName}. ` +
      `Do NOT ask for their name or any other field listed above unless they correct you.`
    : `DIRECTIVE (overrides collection steps in the script below): ` +
      `These lead fields are already known. Use them naturally. ` +
      `Do NOT re-ask for any field listed above unless the caller corrects you.`;

  return `=== LEAD CONTEXT ===\n${lines.join("\n")}\n\n${directive}\n===================`;
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

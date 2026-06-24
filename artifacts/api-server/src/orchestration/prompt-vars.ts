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

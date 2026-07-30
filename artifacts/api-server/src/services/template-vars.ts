/**
 * Shared {{variable}} interpolation for Email + WhatsApp content.
 *
 * Supports nested paths via dotted keys from a flat/nested context map.
 * Missing values become empty strings (never leave raw {{tokens}} unless
 * leaveUnresolved is true).
 */

export type TemplateContext = Record<string, unknown>;

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function getPath(ctx: TemplateContext, path: string): unknown {
  if (!path) return undefined;
  if (Object.prototype.hasOwnProperty.call(ctx, path) && !path.includes(".")) {
    return ctx[path];
  }
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, ctx);
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    try { return JSON.stringify(v); } catch { return ""; }
  }
  return String(v);
}

/** Flatten common call/journey context into friendly top-level aliases. */
export function normalizeTemplateContext(raw: TemplateContext): TemplateContext {
  const call = (raw["call"] && typeof raw["call"] === "object")
    ? (raw["call"] as Record<string, unknown>)
    : {};
  const disposition = call["disposition"];
  const dispositionStr = typeof disposition === "object" && disposition
    ? Object.entries(disposition as Record<string, unknown>)
        .map(([k, v]) => `${k}: ${toStr(v)}`)
        .join(", ")
    : toStr(disposition);

  return {
    ...raw,
    name: toStr(raw["name"] || raw["caller_name"] || "there"),
    phone: toStr(raw["phone"] || raw["to_number"] || ""),
    email: toStr(raw["email"] || raw["caller_email"] || ""),
    summary: toStr(raw["summary"] || call["summary"] || ""),
    disposition: dispositionStr,
    meet_link: toStr(raw["meet_link"] || raw["meeting_link"] || call["meetLink"] || ""),
    agent_name: toStr(raw["agent_name"] || raw["agentName"] || "SnapServe"),
    business_name: toStr(raw["business_name"] || raw["businessName"] || ""),
    call_status: toStr(call["status"] || raw["call_status"] || ""),
    callback_at: toStr(raw["callback_at"] || ""),
    call_id: toStr(call["callId"] || raw["call_id"] || ""),
  };
}

export function interpolateTemplate(
  template: string,
  context: TemplateContext,
  opts?: { leaveUnresolved?: boolean },
): string {
  if (!template) return "";
  const ctx = normalizeTemplateContext(context);
  return template.replace(TOKEN_RE, (_m, key: string) => {
    const val = getPath(ctx, key);
    if (val === undefined || val === null) {
      return opts?.leaveUnresolved ? `{{${key}}}` : "";
    }
    return toStr(val);
  });
}

export function listTemplateVariables(): Array<{ key: string; label: string }> {
  return [
    { key: "name", label: "Lead name" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "summary", label: "Call summary" },
    { key: "disposition", label: "Disposition" },
    { key: "meet_link", label: "Meeting link" },
    { key: "agent_name", label: "Agent name" },
    { key: "business_name", label: "Business name" },
    { key: "call_status", label: "Call status" },
    { key: "callback_at", label: "Callback time" },
  ];
}

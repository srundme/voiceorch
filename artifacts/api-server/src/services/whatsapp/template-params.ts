/**
 * Resolve an agent's explicit {{n}} mapping for an after-call WhatsApp template
 * into per-call strings. An empty string means "no explicit value" — the caller
 * keeps whatever buildMetaParams inferred for that slot.
 */
import type { AfterCallTemplateParam, AfterCallTemplateParamSource } from "@workspace/db";

export const TEMPLATE_PARAM_SOURCES: readonly AfterCallTemplateParamSource[] = [
  "auto", "caller_name", "agent_name", "summary", "phone", "outcome",
  "meeting_time", "meet_link", "field", "text",
];

export type TemplateParamContext = {
  callerName: string;
  agentName: string;
  summary: string;
  phone: string;
  outcome: string;
  meetingTime: string;
  meetLink: string;
  /** Extracted disposition values, keyed by "Data to collect" field key. */
  fields: Record<string, unknown> | null | undefined;
};

/** Keep only well-formed entries; anything unknown becomes "auto". */
export function parseTemplateParams(raw: unknown): AfterCallTemplateParam[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.slice(0, 20).map((item): AfterCallTemplateParam => {
    if (!item || typeof item !== "object") return { source: "auto" };
    const o = item as Record<string, unknown>;
    const source = TEMPLATE_PARAM_SOURCES.includes(o["source"] as AfterCallTemplateParamSource)
      ? (o["source"] as AfterCallTemplateParamSource)
      : "auto";
    const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 1024) : undefined);
    const p: AfterCallTemplateParam = { source };
    if (source === "field") p.key = str(o["key"])?.trim();
    if (source === "text") p.text = str(o["text"]);
    const fallback = str(o["fallback"]);
    if (fallback) p.fallback = fallback;
    return p;
  });
  return out.some((p) => p.source !== "auto") ? out : undefined;
}

function fieldValue(fields: TemplateParamContext["fields"], key: string | undefined): string {
  if (!fields || !key) return "";
  const v = fields[key];
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return /^unknown$/i.test(v.trim()) ? "" : v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined).join(", ");
  return "";
}

function sourceValue(p: AfterCallTemplateParam, ctx: TemplateParamContext): string {
  switch (p.source) {
    case "caller_name": return ctx.callerName;
    case "agent_name": return ctx.agentName;
    case "summary": return ctx.summary;
    case "phone": return ctx.phone;
    case "outcome": return ctx.outcome;
    case "meeting_time": return ctx.meetingTime;
    case "meet_link": return ctx.meetLink;
    case "field": return fieldValue(ctx.fields, p.key);
    case "text": return p.text ?? "";
    default: return "";
  }
}

/** One entry per mapped slot: the resolved text, or "" to keep the inferred value. */
export function resolveTemplateParams(
  mapping: AfterCallTemplateParam[] | undefined,
  ctx: TemplateParamContext,
): string[] {
  return (mapping ?? []).map((p) => {
    if (p.source === "auto") return "";
    return (sourceValue(p, ctx) || p.fallback || "").replace(/\s+/g, " ").trim();
  });
}

/** Overlay explicit values onto inferred params; explicit wins wherever it is non-empty. */
export function applyExplicitParams(inferred: string[], explicit: string[]): string[] {
  return inferred.map((v, i) => (explicit[i] ? explicit[i]! : v));
}

/** Best caller name for a call that may not have a booking. */
export function pickCallerName(
  bookedName: string | null | undefined,
  leadName: string | null | undefined,
  fields: Record<string, unknown> | null | undefined,
): string {
  const fromFields = ["name", "caller_name", "customer_name", "full_name"]
    .map((k) => fieldValue(fields, k))
    .find(Boolean);
  return (bookedName ?? "").trim() || (leadName ?? "").trim() || fromFields || "";
}

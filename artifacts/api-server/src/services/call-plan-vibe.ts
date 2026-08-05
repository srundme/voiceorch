/**
 * Classify natural-language call-plan requests into lead source + recipe template.
 * Heuristic first; optional Gemini refine when a key is available.
 */

export type CallPlanVibeLeadSource = "list" | "sheet" | "paste" | "website" | "meta";
export type CallPlanVibeTemplateId =
  | "lead_followup"
  | "soft_nudge"
  | "sheet_live"
  | "form_followup"
  | "callback_rescue"
  | "blank";

export type CallPlanVibeDraft = {
  name: string;
  leadSource: CallPlanVibeLeadSource;
  templateId: CallPlanVibeTemplateId;
  sheetRunMode: "once" | "live";
  summary: string;
  usedModel: boolean;
};

const TEMPLATE_BLURBS: Record<CallPlanVibeTemplateId, string> = {
  lead_followup: "Call → if no answer, WhatsApp → wait 1 day → call again → WhatsApp → stop",
  soft_nudge: "Call → WhatsApp → wait 2 days → call again → stop",
  sheet_live: "Call → update sheet → if no answer, WhatsApp → wait → call again → update sheet → stop",
  form_followup: "Call new lead → if no answer, WhatsApp → wait → call again → stop",
  callback_rescue: "Call → if no answer, schedule callback + WhatsApp → stop",
  blank: "Call → WhatsApp → Wait → Stop (edit freely)",
};

function titleCaseFromPrompt(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Call plan";
  const short = cleaned.length > 48 ? `${cleaned.slice(0, 45).trim()}…` : cleaned;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

/** Deterministic draft from keywords — always available. */
export function classifyCallPlanPrompt(prompt: string): CallPlanVibeDraft {
  const t = prompt.toLowerCase();

  let leadSource: CallPlanVibeLeadSource = "list";
  let templateId: CallPlanVibeTemplateId = "lead_followup";
  let sheetRunMode: "once" | "live" = "live";

  if (/\b(sheet|spreadsheet|google\s*sheet|gsheet)\b/.test(t)) {
    leadSource = "sheet";
    templateId = "sheet_live";
    sheetRunMode = /\b(drip|live|new\s*row|keep\s*(live|watching)|ongoing)\b/.test(t)
      ? "live"
      : /\b(drain|once|batch|today'?s?\s*list|fixed)\b/.test(t)
        ? "once"
        : "live";
  } else if (/\b(meta|facebook|instagram|lead\s*ad)\b/.test(t)) {
    leadSource = "meta";
    templateId = "form_followup";
  } else if (/\b(website|web\s*form|form\s*lead|landing\s*page)\b/.test(t)) {
    leadSource = "website";
    templateId = "form_followup";
  } else if (/\b(paste|phone\s*list|numbers?|one[- ]?off)\b/.test(t)) {
    leadSource = "paste";
    templateId = "soft_nudge";
  } else if (/\b(csv|people\s*list|campaign\s*list|upload)\b/.test(t)) {
    leadSource = "list";
    templateId = "lead_followup";
  }

  if (/\b(callback|call\s*back|schedule\s*callback)\b/.test(t)) {
    templateId = "callback_rescue";
  } else if (/\b(blank|from\s*scratch|empty|custom)\b/.test(t)) {
    templateId = "blank";
  } else if (leadSource !== "sheet" && /\b(soft|nudge|gentle)\b/.test(t)) {
    templateId = "soft_nudge";
  } else if (
    leadSource !== "sheet"
    && leadSource !== "website"
    && leadSource !== "meta"
    && /\b(no\s*answer|missed|retry|call\s*again|whatsapp|wa)\b/.test(t)
  ) {
    templateId = "lead_followup";
  }

  const sourceLabel =
    leadSource === "sheet" ? "Google Sheet"
      : leadSource === "paste" ? "pasted numbers"
        : leadSource === "website" ? "website form"
          : leadSource === "meta" ? "Meta leads"
            : "Lead list";

  const sheetNote =
    leadSource === "sheet"
      ? sheetRunMode === "live"
        ? " Drip new rows into the queue."
        : " Drain today’s rows once."
      : "";

  return {
    name: titleCaseFromPrompt(prompt),
    leadSource,
    templateId,
    sheetRunMode,
    summary: `People from ${sourceLabel}.${sheetNote} Recipe: ${TEMPLATE_BLURBS[templateId]}`,
    usedModel: false,
  };
}

function parseModelJson(raw: string): Partial<CallPlanVibeDraft> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const leadSources = new Set(["list", "sheet", "paste", "website", "meta"]);
    const templates = new Set([
      "lead_followup", "soft_nudge", "sheet_live", "form_followup", "callback_rescue", "blank",
    ]);
    const leadSource = String(obj.leadSource ?? "");
    const templateId = String(obj.templateId ?? "");
    if (!leadSources.has(leadSource) || !templates.has(templateId)) return null;
    const sheetRunMode = obj.sheetRunMode === "once" ? "once" : "live";
    return {
      name: typeof obj.name === "string" && obj.name.trim() ? obj.name.trim().slice(0, 80) : undefined,
      leadSource: leadSource as CallPlanVibeLeadSource,
      templateId: templateId as CallPlanVibeTemplateId,
      sheetRunMode,
      summary: typeof obj.summary === "string" ? obj.summary.trim().slice(0, 280) : undefined,
    };
  } catch {
    return null;
  }
}

/** Optional Gemini refine; falls back to heuristic on any failure. */
export async function draftCallPlanFromPrompt(
  prompt: string,
  geminiKey: string | null,
  callGenerate?: (key: string, system: string, user: string) => Promise<string>,
): Promise<CallPlanVibeDraft> {
  const base = classifyCallPlanPrompt(prompt);
  if (!geminiKey || !callGenerate) return base;

  const system = `You draft SnapServe call plans. Reply with ONLY JSON:
{"name":"short plan name","leadSource":"list|sheet|paste|website|meta","templateId":"lead_followup|soft_nudge|sheet_live|form_followup|callback_rescue|blank","sheetRunMode":"once|live","summary":"one sentence for the user"}
Rules:
- leadSource=sheet → prefer templateId sheet_live; sheetRunMode live=drip new rows, once=drain list
- website/meta leads → form_followup
- no-answer → wait → call again → lead_followup
- callback → callback_rescue
- Keep name under 60 chars. summary under 200 chars.`;

  try {
    const text = await callGenerate(geminiKey, system, prompt.slice(0, 2000));
    const parsed = parseModelJson(text);
    if (!parsed?.leadSource || !parsed.templateId) return base;
    const templateId = parsed.templateId;
    return {
      name: parsed.name || base.name,
      leadSource: parsed.leadSource,
      templateId,
      sheetRunMode: parsed.leadSource === "sheet" ? (parsed.sheetRunMode ?? base.sheetRunMode) : "once",
      summary: parsed.summary || `Recipe: ${TEMPLATE_BLURBS[templateId]}`,
      usedModel: true,
    };
  } catch {
    return base;
  }
}

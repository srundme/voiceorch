export type CampaignAnalyticsQuestion = {
  id: string;
  label: string;
  type: "boolean" | "enum" | "text";
  options?: string[];
  description?: string;
};

export function normalizeAnalyticsAnswers(
  raw: unknown,
  questions: CampaignAnalyticsQuestion[],
): Record<string, string | boolean | null> {
  const out: Record<string, string | boolean | null> = {};
  if (!questions.length) return out;

  const src =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  for (const q of questions) {
    const v = src[q.id];
    if (v == null) {
      out[q.id] = null;
      continue;
    }
    if (q.type === "boolean") {
      if (typeof v === "boolean") out[q.id] = v;
      else if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        out[q.id] = s === "true" || s === "yes" || s === "y" || s === "1"
          ? true
          : s === "false" || s === "no" || s === "n" || s === "0"
            ? false
            : null;
      } else out[q.id] = null;
      continue;
    }
    if (q.type === "enum") {
      const s = String(v).trim();
      const opts = q.options ?? [];
      const match = opts.find((o) => o.toLowerCase() === s.toLowerCase());
      out[q.id] = match ?? null;
      continue;
    }
    const text = String(v).trim();
    out[q.id] = text ? text.slice(0, 200) : null;
  }
  return out;
}

export function buildAnswersSchema(questions: CampaignAnalyticsQuestion[]): Record<string, unknown> | null {
  if (!questions.length) return null;
  const properties: Record<string, unknown> = {};
  for (const q of questions) {
    if (q.type === "boolean") {
      properties[q.id] = { type: ["boolean", "null"] };
    } else if (q.type === "enum" && q.options?.length) {
      properties[q.id] = { anyOf: [{ type: "string", enum: [...q.options] }, { type: "null" }] };
    } else {
      properties[q.id] = { type: ["string", "null"] };
    }
  }
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}

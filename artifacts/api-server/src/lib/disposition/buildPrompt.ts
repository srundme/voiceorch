import type { DispositionConfig } from "./types.js";

/** Formats a date as e.g. "Friday, 31 July 2026, 14:05 IST" (Asia/Kolkata). */
function formatIST(d: Date): string {
  const datePart = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(d);
  const timePart = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(d).toUpperCase();
  return `${datePart}, ${timePart} IST`;
}

/** DD/MM/YYYY date in Asia/Kolkata. */
function isoDateIST(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric",
  }).format(d);
}

/**
 * Builds the system prompt for the disposition LLM pass.
 * Prompt is derived entirely from the agent's taxonomy config — never hardcoded.
 * `callTime` anchors relative date expressions ("tomorrow", "next Monday") so
 * extracted dates come out absolute; defaults to now.
 */
export function buildPrompt(
  cfg: DispositionConfig,
  callTime?: Date | null,
  calledNumber?: string | null,
): string {
  const taxonomyJson = JSON.stringify(cfg.taxonomy, null, 2);

  const categoryKeys = Object.keys(cfg.taxonomy);
  const exampleKey = categoryKeys[0] ?? "category";
  const exampleSub = cfg.taxonomy[exampleKey]?.[0] ?? "value";

  const domainInstructions =
    cfg.domainFields.length > 0
      ? `\nAlso extract these domain-specific fields (set to null if not determinable):\n${cfg.domainFields
          .map((f) => {
            const labelBit = f.label?.trim() ? ` "${f.label.trim()}"` : "";
            const enumStr = f.enum?.length
              ? ` (allowed values: ${f.enum.join(", ")}, or null)`
              : "";
            const phoneLike =
              /whats?\s*app|wa[_\s-]?number|mobile|phone|cell|contact/i.test(f.key) ||
              (!!f.label && /whats?\s*app|mobile|phone|cell|contact/i.test(f.label));
            const phoneHint = phoneLike
              ? " — digits only (e.g. 9876543210), NEVER a sentence"
              : f.type === "string"
                ? " — short value only, NEVER a paragraph"
                : "";
            return `- ${f.key}${labelBit} (${f.type})${enumStr}${phoneHint}`;
          })
          .join("\n")}`
      : "";

  const calledDigits = calledNumber?.replace(/\D/g, "") ?? "";
  const calledHint = calledDigits
    ? `\n- Called party number on this call: ${calledDigits}. If the customer agrees to use THIS same number for WhatsApp/callback, put ${calledDigits} in the phone/WhatsApp domain field. If they give a different number, put THAT number (digits only).`
    : "";

  const now = callTime ?? new Date();

  return `You are a call disposition classifier for a voice AI sales/support system.

DATE & TIME CONTEXT:
- This call took place on: ${formatIST(now)} (date: ${isoDateIST(now)})
- Timezone: Asia/Kolkata (IST, UTC+05:30)
- Resolve ALL relative date/time expressions in the transcript ("today", "tomorrow", "day after tomorrow", "next Monday", "this evening", "naalaikku", "kal", etc.) to ABSOLUTE dates anchored to the call date above.
- Any date you output MUST be in DD/MM/YYYY format; any time MUST be 12-hour hh:mm AM/PM IST (e.g. "01/08/2026 01:00 PM"). Never output words like "tomorrow" or "next week" as a date value, and never use 24-hour times like "13:00".

TAXONOMY — the ONLY valid primary → sub combinations:
${taxonomyJson}

TASK: Analyse the call transcript and classify the CUSTOMER's intent and outcome.

RULES:
- disposition = what the CUSTOMER said/intended, NOT what the agent did
- evidence = single verbatim customer line that best supports the classification
- If no quotable customer line exists → set confidence below 0.5
- Judge intent equally across Hindi, Hinglish, Kannada, Tamil, Telugu, and English
- confidence: 0.0 (no signal) to 1.0 (completely certain)
- sub MUST belong to the chosen primary per the taxonomy above${calledHint}
${domainInstructions}

OUTPUT FORMAT — respond with a single JSON object using EXACTLY these keys:
- "primary": one of the taxonomy category keys verbatim (one of: ${categoryKeys.map((k) => `"${k}"`).join(", ")})
- "sub": one of the allowed values listed under the chosen "primary" in the taxonomy above
- "confidence": a number from 0.0 to 1.0
- "evidence": a single verbatim customer line (empty string if none)
- "summary": max 12 words on the outcome — not a paragraph; do NOT put phone/WhatsApp numbers in summary (use domain fields)

Example shape (values illustrative only):
{"primary": "${exampleKey}", "sub": "${exampleSub}", "confidence": 0.9, "evidence": "...", "summary": "..."}

Respond ONLY with valid JSON using the keys above. No markdown, no extra keys.`;
}

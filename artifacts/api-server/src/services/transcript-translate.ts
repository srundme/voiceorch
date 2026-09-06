/**
 * Translate call transcript lines via Sarvam Mayura (/translate).
 * Source language is auto-detected; target is a Mayura-supported Indian language code.
 */
import { logger } from "../lib/logger.js";

/** UI + API target languages (Mayura:v1 set). Odia uses Sarvam's `od-IN`. */
export const TRANSCRIPT_TRANSLATE_LANGUAGES = [
  { value: "en-IN", label: "English" },
  { value: "hi-IN", label: "Hindi" },
  { value: "ta-IN", label: "Tamil" },
  { value: "te-IN", label: "Telugu" },
  { value: "kn-IN", label: "Kannada" },
  { value: "ml-IN", label: "Malayalam" },
  { value: "mr-IN", label: "Marathi" },
  { value: "gu-IN", label: "Gujarati" },
  { value: "bn-IN", label: "Bengali" },
  { value: "pa-IN", label: "Punjabi" },
  { value: "od-IN", label: "Odia" },
] as const;

export type TranscriptTranslateLang =
  (typeof TRANSCRIPT_TRANSLATE_LANGUAGES)[number]["value"];

const ALLOWED = new Set<string>(TRANSCRIPT_TRANSLATE_LANGUAGES.map((l) => l.value));

/** Map product BCP-47 (or-IN) → Sarvam translate code (od-IN). */
export function toSarvamTranslateTarget(code: string): string {
  const t = code.trim();
  if (t === "or-IN" || t === "or") return "od-IN";
  return t;
}

export function isTranscriptTranslateLang(code: string): code is TranscriptTranslateLang {
  const normalized = toSarvamTranslateTarget(code);
  return ALLOWED.has(normalized);
}

const MAX_CHARS = 900; // Mayura limit is 1000; leave headroom

async function getSarvamKey(): Promise<string | null> {
  const { getSarvamManagedKey } = await import("./platform-chat-llm.js");
  return getSarvamManagedKey();
}

async function translateChunk(
  apiKey: string,
  text: string,
  targetLanguageCode: string,
): Promise<string> {
  const res = await fetch("https://api.sarvam.ai/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": apiKey,
    },
    body: JSON.stringify({
      input: text,
      source_language_code: "auto",
      target_language_code: targetLanguageCode,
      model: "mayura:v1",
      mode: "formal",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sarvam translate failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { translated_text?: string };
  return (data.translated_text ?? "").trim() || text;
}

/** Split long text into ≤MAX_CHARS chunks on sentence/whitespace boundaries. */
function chunkText(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > MAX_CHARS) {
    let cut = rest.lastIndexOf(" ", MAX_CHARS);
    if (cut < MAX_CHARS * 0.5) cut = MAX_CHARS;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}

export async function translatePlainText(
  text: string,
  targetLanguage: string,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return text;

  const apiKey = await getSarvamKey();
  if (!apiKey) {
    throw new Error("Translation is not configured (missing Sarvam API key)");
  }

  const target = toSarvamTranslateTarget(targetLanguage);
  const parts = chunkText(trimmed);
  const out: string[] = [];
  for (const part of parts) {
    out.push(await translateChunk(apiKey, part, target));
  }
  return out.join(" ").trim();
}

export type TranscriptLineIn = {
  role?: string;
  content?: string;
  timestamp?: string;
  [key: string]: unknown;
};

/**
 * Translate speakable content of each transcript line.
 * Skips empty / tool-marker lines. Runs with limited concurrency.
 */
export async function translateTranscriptLines(
  lines: TranscriptLineIn[],
  targetLanguage: string,
  opts?: { concurrency?: number },
): Promise<TranscriptLineIn[]> {
  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 3, 5));
  const results = lines.map((l) => ({ ...l }));
  let cursor = 0;

  async function worker() {
    while (cursor < lines.length) {
      const i = cursor++;
      const content = String(lines[i]?.content ?? "").trim();
      if (!content) continue;
      // Keep tool markers as-is
      if (/^\[(calling tool|Tool result)/i.test(content)) continue;
      try {
        results[i] = {
          ...results[i],
          content: await translatePlainText(content, targetLanguage),
        };
      } catch (err) {
        logger.warn({ err, index: i }, "transcript line translate failed — keeping original");
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

/** Parse stored call.transcript (JSON array or plain text) into translateable lines. */
export function parseTranscriptForTranslate(raw: string | null | undefined): {
  kind: "json" | "plain";
  lines: TranscriptLineIn[];
  plainLines?: string[];
} {
  if (!raw?.trim()) return { kind: "plain", lines: [], plainLines: [] };

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return {
        kind: "json",
        lines: parsed.map((l) =>
          typeof l === "object" && l
            ? (l as TranscriptLineIn)
            : { role: "unknown", content: String(l ?? "") },
        ),
      };
    }
  } catch {
    /* plain */
  }

  const plainLines = raw.split(/\r?\n/);
  const lines: TranscriptLineIn[] = plainLines.map((line) => {
    const agent = line.match(/^Agent:\s*([\s\S]*)/);
    if (agent) return { role: "assistant", content: agent[1] ?? "" };
    const caller = line.match(/^Caller:\s*([\s\S]*)/);
    if (caller) return { role: "user", content: caller[1] ?? "" };
    return { role: "unknown", content: line };
  });
  return { kind: "plain", lines, plainLines };
}

export function rebuildPlainTranscript(
  originalPlainLines: string[],
  translatedLines: TranscriptLineIn[],
): string {
  return originalPlainLines
    .map((orig, i) => {
      const translated = String(translatedLines[i]?.content ?? "").trim();
      if (!translated) return orig;
      if (/^Agent:\s*/i.test(orig)) return `Agent: ${translated}`;
      if (/^Caller:\s*/i.test(orig)) return `Caller: ${translated}`;
      // Tool / other lines: keep original unless we translated unknown content
      if (/^\[(calling tool|Tool result)/i.test(orig)) return orig;
      return translated;
    })
    .join("\n");
}

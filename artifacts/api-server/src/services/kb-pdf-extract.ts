/**
 * Sarvam GLM 5.2 PDF ingestion for the Knowledge Base.
 *
 * Flow: pdf-parse extracts text → GLM 5.2 (512K context) semantically chunks
 * it into knowledge entries (titles, keywords, markdown tables preserved from
 * text). Gemini multimodal was removed.
 *
 * Contract: returns null on ANY failure or ineligibility (no text, no key,
 * timeout, unparseable output) — the caller then falls back to legacy
 * fixed-size chunking. NEVER throws.
 */
import { createRequire } from "node:module";
import { logger } from "../lib/logger.js";
import { getSarvamManagedKey, platformChatText } from "./platform-chat-llm.js";
import type { KbEntryInput } from "./kb-ingest.js";

/** Long-context open-source model on Sarvam /v2 — good for large PDF text. */
const PDF_CHUNK_MODEL = "glm5.2";
const PDF_CHUNK_TIMEOUT_MS = Number(process.env["KB_PDF_CHUNK_TIMEOUT_MS"] ?? 120_000);
/** Cap raw extracted text fed to the model (chars). GLM 5.2 is 512K tokens; stay modest. */
const PDF_TEXT_MAX_CHARS = 200_000;
const MAX_CHUNKS = 300;
const MAX_CHUNK_CHARS = 8000;

const EXTRACT_PROMPT = `You are a document-ingestion engine for a voice-agent knowledge base.
Convert the document text into knowledge chunks:
- Include every fact, number, price, date, name, policy, and procedure.
- Keep markdown tables intact when present.
- Preserve the original language of the document (do NOT translate).
- Split into self-contained chunks of roughly 500-2500 characters, one topic/section per chunk.
- Each chunk gets a short descriptive "title" and 3-8 comma-separated "keywords" (include likely search terms and synonyms).
Respond with ONLY valid JSON in exactly this shape:
{"chunks":[{"title":"...","content":"...","keywords":"..."}]}`;

async function extractPdfText(buffer: Buffer): Promise<string | null> {
  try {
    const require = createRequire(import.meta.url);
    const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;
    const parsed = await pdfParse(buffer);
    const text = (parsed.text ?? "").trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    logger.warn({ err: String(err) }, "KB PDF pdf-parse failed");
    return null;
  }
}

function parseChunksJson(raw: string): KbEntryInput[] | null {
  let t = raw.trim();
  if (t.startsWith("```")) t = t.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  if (!t.startsWith("{")) {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) t = m[0];
  }
  try {
    const parsed = JSON.parse(t) as { chunks?: Array<{ title?: unknown; content?: unknown; keywords?: unknown }> };
    if (!Array.isArray(parsed.chunks)) return null;
    const out: KbEntryInput[] = [];
    for (const c of parsed.chunks.slice(0, MAX_CHUNKS)) {
      const content = typeof c.content === "string" ? c.content.trim().slice(0, MAX_CHUNK_CHARS) : "";
      if (!content) continue;
      out.push({
        title: typeof c.title === "string" && c.title.trim() ? c.title.trim().slice(0, 300) : undefined,
        content,
        keywords: typeof c.keywords === "string" && c.keywords.trim() ? c.keywords.trim().slice(0, 500) : undefined,
      });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

/**
 * Extract knowledge chunks from a PDF via pdf-parse + Sarvam GLM 5.2.
 * Returns null when unavailable or fails (caller falls back to legacy chunks).
 */
export async function extractPdfChunksWithLlm(
  buffer: Buffer,
  filename: string,
): Promise<KbEntryInput[] | null> {
  try {
    const key = await getSarvamManagedKey();
    if (!key) {
      logger.info({ filename }, "KB PDF: no Sarvam key — using legacy chunk fallback");
      return null;
    }

    const text = await extractPdfText(buffer);
    if (!text) {
      logger.info({ filename }, "KB PDF: no extractable text — using legacy chunk fallback");
      return null;
    }

    const clipped = text.slice(0, PDF_TEXT_MAX_CHARS);
    const raw = await platformChatText({
      system: EXTRACT_PROMPT,
      messages: [{
        role: "user",
        content: `Filename: ${filename}\n\nDOCUMENT TEXT:\n${clipped}`,
      }],
      temperature: 0.1,
      maxTokens: 16384,
      timeoutMs: PDF_CHUNK_TIMEOUT_MS,
      model: PDF_CHUNK_MODEL,
      json: true,
    });

    const out = parseChunksJson(raw);
    if (!out) {
      logger.warn({ filename, snippet: raw.slice(0, 300) }, "KB PDF GLM chunk JSON unparseable — falling back");
      return null;
    }
    logger.info({ filename, chunks: out.length, model: PDF_CHUNK_MODEL }, "KB PDF GLM 5.2 chunking succeeded");
    return out;
  } catch (err) {
    logger.warn({ filename, err: String(err) }, "KB PDF GLM chunking failed — falling back to legacy chunks");
    return null;
  }
}

/** @deprecated Use extractPdfChunksWithLlm — Gemini multimodal path removed. */
export const extractPdfChunksWithGemini = extractPdfChunksWithLlm;

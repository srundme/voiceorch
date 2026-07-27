/**
 * Gemini-multimodal PDF ingestion for the Knowledge Base.
 *
 * Sends the raw PDF bytes to gemini-3.6-flash (native PDF understanding:
 * text, tables, charts, images) and asks for semantically-chunked JSON
 * entries. This preserves tabular data (as markdown tables) and describes
 * figures — content pdf-parse loses entirely.
 *
 * Contract: returns null on ANY failure or ineligibility (file too large,
 * no key, timeout, truncated/unparseable output) — the caller then falls
 * back to the legacy pdf-parse text extraction. NEVER throws.
 */
import { logger } from "../lib/logger.js";
import { getGeminiKey } from "./kb-embeddings.js";
import type { KbEntryInput } from "./kb-ingest.js";

const PDF_GEMINI_MODEL = "gemini-3.6-flash";
/** Inline-data request cap is 20MB total; base64 expands 4/3, so cap raw at 14MB. */
const PDF_GEMINI_MAX_BYTES = 14 * 1024 * 1024;
const PDF_GEMINI_TIMEOUT_MS = Number(process.env["KB_PDF_GEMINI_TIMEOUT_MS"] ?? 120_000);
const MAX_CHUNKS = 300;
const MAX_CHUNK_CHARS = 8000;

const EXTRACT_PROMPT = `You are a document-ingestion engine for a voice-agent knowledge base.
Read the attached PDF COMPLETELY and convert ALL of its information into knowledge chunks:
- Include every fact, number, price, date, name, policy, and procedure.
- Render tables as GitHub-flavored markdown tables inside the chunk content.
- Describe charts, diagrams, and meaningful images in words (data points, trends, labels).
- Preserve the original language of the document (do NOT translate).
- Split into self-contained chunks of roughly 500-2500 characters, one topic/section per chunk.
- Each chunk gets a short descriptive "title" and 3-8 comma-separated "keywords" (include likely search terms and synonyms).
Respond with ONLY valid JSON in exactly this shape:
{"chunks":[{"title":"...","content":"...","keywords":"..."}]}`;

/**
 * Extract knowledge chunks from a PDF via Gemini multimodal understanding.
 * Returns null when the Gemini path is unavailable or fails (caller falls
 * back to pdf-parse).
 */
export async function extractPdfChunksWithGemini(
  buffer: Buffer,
  filename: string,
): Promise<KbEntryInput[] | null> {
  try {
    if (buffer.length > PDF_GEMINI_MAX_BYTES) {
      logger.info({ filename, bytes: buffer.length }, "KB PDF too large for Gemini inline — using pdf-parse fallback");
      return null;
    }
    const key = await getGeminiKey();
    if (!key) {
      logger.info({ filename }, "KB PDF: no Gemini key — using pdf-parse fallback");
      return null;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${PDF_GEMINI_MODEL}:generateContent`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { inlineData: { mimeType: "application/pdf", data: buffer.toString("base64") } },
            { text: EXTRACT_PROMPT },
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 65536,
          responseMimeType: "application/json",
        },
      }),
      signal: AbortSignal.timeout(PDF_GEMINI_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const detail = (await resp.text().catch(() => "")).slice(0, 300);
      logger.warn({ filename, status: resp.status, detail }, "KB PDF Gemini extraction HTTP error — falling back");
      return null;
    }
    const json = (await resp.json()) as {
      candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
    };
    const cand = json.candidates?.[0];
    // A JSON-mode response truncated at the token cap is unparseable — treat
    // any non-STOP finish as a failed extraction rather than retrying blind.
    if (!cand || (cand.finishReason && cand.finishReason !== "STOP")) {
      logger.warn({ filename, finishReason: cand?.finishReason }, "KB PDF Gemini extraction did not finish cleanly — falling back");
      return null;
    }
    const text = (cand.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    if (!text) return null;

    const parsed = JSON.parse(text) as { chunks?: Array<{ title?: unknown; content?: unknown; keywords?: unknown }> };
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
    if (!out.length) return null;
    logger.info({ filename, chunks: out.length }, "KB PDF Gemini multimodal extraction succeeded");
    return out;
  } catch (err) {
    logger.warn({ filename, err: String(err) }, "KB PDF Gemini extraction failed — falling back to pdf-parse");
    return null;
  }
}

/**
 * Gemini multimodal image analysis for the analyze_image agent tool.
 */
import { logger } from "../lib/logger.js";
import { getGeminiKey } from "./kb-embeddings.js";
import {
  cacheMediaAnalysis,
  fetchImageFromUrl,
  getCallMediaById,
  listCallMediaForCall,
  normalizeImageMime,
  storeCallMedia,
} from "./call-media.js";

const VISION_MODEL = process.env["VISION_GEMINI_MODEL"] ?? "gemini-2.5-flash";
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = Number(process.env["VISION_ANALYZE_TIMEOUT_MS"] ?? 45_000);

const DEFAULT_QUESTION =
  "Describe what you see in detail. If this looks like vehicle/property damage, insurance evidence, " +
  "an ID, invoice, or form, extract the key facts (damage location/severity, names, numbers, dates). " +
  "Be concrete and useful for a voice agent speaking to the caller. Keep the answer under 250 words.";

export async function analyzeImageBuffer(
  buffer: Buffer,
  mimeType: string,
  question?: string,
): Promise<string> {
  if (buffer.length > MAX_BYTES) throw new Error("Image too large for analysis");
  const key = await getGeminiKey();
  if (!key) throw new Error("No Gemini API key configured — add a Google key on Providers to enable vision");

  const mime = normalizeImageMime(mimeType);
  const prompt = (question?.trim() || DEFAULT_QUESTION).slice(0, 2000);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType: mime, data: buffer.toString("base64") } },
          { text: prompt },
        ],
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024,
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!resp.ok) {
    const detail = (await resp.text().catch(() => "")).slice(0, 300);
    logger.warn({ status: resp.status, detail }, "Vision analyze HTTP error");
    throw new Error(`Vision analysis failed (HTTP ${resp.status})`);
  }

  const json = (await resp.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("Vision model returned empty analysis");
  return text;
}

/**
 * Resolve media_id / image_url / latest-for-call and return analysis text for the LLM.
 */
export async function executeAnalyzeImage(opts: {
  callId: number;
  agentId: number;
  userId?: string | null;
  phone?: string | null;
  args: Record<string, unknown>;
}): Promise<string> {
  const mediaIdRaw = opts.args["media_id"] ?? opts.args["mediaId"];
  const imageUrl = typeof opts.args["image_url"] === "string"
    ? opts.args["image_url"]
    : typeof opts.args["imageUrl"] === "string"
      ? opts.args["imageUrl"]
      : undefined;
  const question = typeof opts.args["question"] === "string" ? opts.args["question"] : undefined;
  const useLatest = opts.args["use_latest"] === true || opts.args["use_latest"] === "true"
    || (!mediaIdRaw && !imageUrl);

  let buffer: Buffer | null = null;
  let mimeType = "image/jpeg";
  let mediaId: number | null = null;

  if (mediaIdRaw != null) {
    const id = typeof mediaIdRaw === "number" ? mediaIdRaw : parseInt(String(mediaIdRaw), 10);
    if (!Number.isFinite(id)) return "analyze_image_error: invalid media_id";
    const row = await getCallMediaById(id);
    if (!row) return `analyze_image_error: media_id ${id} not found`;
    if (row.callId && row.callId !== opts.callId && row.agentId !== opts.agentId) {
      return "analyze_image_error: media does not belong to this call";
    }
    if (row.analysisText?.trim()) {
      return `Vision analysis (cached, media_id=${id}):\n${row.analysisText.trim()}`;
    }
    buffer = row.imageData;
    mimeType = row.mimeType;
    mediaId = row.id;
  } else if (imageUrl?.trim()) {
    try {
      const fetched = await fetchImageFromUrl(imageUrl.trim());
      buffer = fetched.buffer;
      mimeType = fetched.mimeType;
      const stored = await storeCallMedia({
        callId: opts.callId,
        agentId: opts.agentId,
        userId: opts.userId ?? null,
        phone: opts.phone ?? null,
        source: "url",
        mimeType,
        fileName: fetched.fileName ?? null,
        buffer,
      });
      mediaId = stored.id;
    } catch (err) {
      return `analyze_image_error: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else if (useLatest) {
    const list = await listCallMediaForCall(opts.callId, 1);
    const row = list[0];
    if (!row) {
      return "analyze_image_error: no images available for this call yet. Ask the caller to send a photo on WhatsApp or upload one, then call analyze_image again.";
    }
    if (row.analysisText?.trim()) {
      return `Vision analysis (cached, media_id=${row.id}):\n${row.analysisText.trim()}`;
    }
    buffer = row.imageData;
    mimeType = row.mimeType;
    mediaId = row.id;
  }

  if (!buffer) return "analyze_image_error: no image to analyze";

  try {
    const text = await analyzeImageBuffer(buffer, mimeType, question);
    if (mediaId != null) await cacheMediaAnalysis(mediaId, text);
    logger.info({ callId: opts.callId, mediaId, chars: text.length }, "analyze_image ok");
    return `Vision analysis (media_id=${mediaId ?? "inline"}):\n${text}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ callId: opts.callId, mediaId, err: msg }, "analyze_image failed");
    return `analyze_image_error: ${msg}`;
  }
}

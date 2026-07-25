import { logger } from "../lib/logger.js";
import { db, callMediaTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface ExecuteSarvamVisionOpts {
  callId: number;
  agentId: number;
  userId: number | null;
  phone: string | null;
  args: Record<string, unknown>;
}

/**
 * Execute Sarvam Vision API for document OCR, Aadhaar/PAN verification,
 * and high-resolution invoice/receipt inspection.
 */
export async function executeSarvamVision(opts: ExecuteSarvamVisionOpts): Promise<string> {
  const { callId, args } = opts;
  const mediaIdRaw = args["media_id"] ?? args["mediaId"] ?? args["id"];
  const useLatest = args["use_latest"] === true || args["useLatest"] === true || !mediaIdRaw;
  const customPrompt = (args["prompt"] as string | undefined)?.trim() || 
    "Extract all key document fields, ID numbers, names, addresses, dates, and amounts from this image.";

  try {
    let row: typeof callMediaTable.$inferSelect | undefined;

    if (useLatest || !mediaIdRaw) {
      const rows = await db
        .select()
        .from(callMediaTable)
        .where(eq(callMediaTable.callId, callId))
        .orderBy(callMediaTable.createdAt)
        .limit(1);
      row = rows[0];
    } else {
      const id = parseInt(String(mediaIdRaw), 10);
      if (Number.isFinite(id)) {
        const rows = await db
          .select()
          .from(callMediaTable)
          .where(eq(callMediaTable.id, id))
          .limit(1);
        row = rows[0];
      }
    }

    if (!row || !row.imageData) {
      return "analyze_document_error: no document image available for this call yet. Ask the caller to upload a document photo.";
    }

    const sarvamApiKey = process.env["SARVAM_API_KEY"];
    if (!sarvamApiKey) {
      logger.warn({ callId }, "Sarvam Vision API key missing in environment");
      return "analyze_document_error: SARVAM_API_KEY is not configured on the platform.";
    }

    const base64Image = Buffer.from(row.imageData).toString("base64");

    const response = await fetch("https://api.sarvam.ai/v1/vision", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": sarvamApiKey,
      },
      body: JSON.stringify({
        image: base64Image,
        prompt: customPrompt,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      logger.error({ callId, status: response.status, errText }, "Sarvam Vision API call failed");
      return `analyze_document_error: Sarvam Vision request failed with status ${response.status}`;
    }

    const result = (await response.json()) as { text?: string; content?: string; result?: string };
    const extractedText = result.text ?? result.content ?? result.result ?? JSON.stringify(result);

    logger.info({ callId, mediaId: row.id, chars: extractedText.length }, "Sarvam Vision document OCR completed");
    return extractedText;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ callId, err: msg }, "executeSarvamVision error");
    return `analyze_document_error: ${msg}`;
  }
}

import { GoogleGenAI } from "@google/genai";
import type { IVisionProvider, VisionAnalysisRequest, VisionAnalysisResult } from "./provider.interface.js";
import { logger } from "../../lib/logger.js";

export class GeminiVisionProvider implements IVisionProvider {
  readonly name = "gemini";

  private readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.model = process.env["VISION_GEMINI_MODEL"] ?? "gemini-2.5-flash";
  }

  async analyze(req: VisionAnalysisRequest): Promise<VisionAnalysisResult> {
    const ai = new GoogleGenAI({ apiKey: this.apiKey });

    let prompt = req.prompt;
    if (req.outputSchema) {
      prompt += `\n\nRespond ONLY with a valid JSON object matching this schema:\n${JSON.stringify(req.outputSchema, null, 2)}\nDo not include any markdown fences or additional text.`;
    }

    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string }; fileData?: { fileUri: string; mimeType: string } }> = [];

    if (req.imageData) {
      parts.push({
        inlineData: {
          mimeType: req.mimeType,
          data: req.imageData.toString("base64"),
        },
      });
    } else if (req.urlRef) {
      parts.push({
        fileData: {
          fileUri: req.urlRef,
          mimeType: req.mimeType,
        },
      });
    }

    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts }],
    });

    const text = response.text ?? "";

    let parsed: Record<string, unknown> | undefined;
    if (req.outputSchema) {
      try {
        const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
        parsed = JSON.parse(cleaned) as Record<string, unknown>;
      } catch (err) {
        logger.warn({ err, text }, "GeminiVisionProvider: failed to parse structured output");
      }
    }

    return {
      text,
      parsed,
      providerModel: this.model,
      cachedHit: false,
    };
  }
}

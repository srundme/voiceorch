import OpenAI from "openai";
import type { IVisionProvider, VisionAnalysisRequest, VisionAnalysisResult } from "./provider.interface.js";
import { logger } from "../../lib/logger.js";

const MODEL = "gpt-4o";

export class OpenAIVisionProvider implements IVisionProvider {
  readonly name = "openai";

  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async analyze(req: VisionAnalysisRequest): Promise<VisionAnalysisResult> {
    let prompt = req.prompt;
    if (req.outputSchema) {
      prompt += `\n\nRespond ONLY with a valid JSON object matching this schema:\n${JSON.stringify(req.outputSchema, null, 2)}\nDo not include any markdown fences or additional text.`;
    }

    let imageUrl: string;
    if (req.imageData) {
      imageUrl = `data:${req.mimeType};base64,${req.imageData.toString("base64")}`;
    } else if (req.urlRef) {
      imageUrl = req.urlRef;
    } else {
      throw new Error("OpenAIVisionProvider: either imageData or urlRef must be provided");
    }

    const response = await this.client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: imageUrl },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
    });

    const text = response.choices[0]?.message?.content ?? "";

    let parsed: Record<string, unknown> | undefined;
    if (req.outputSchema) {
      try {
        const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
        parsed = JSON.parse(cleaned) as Record<string, unknown>;
      } catch (err) {
        logger.warn({ err, text }, "OpenAIVisionProvider: failed to parse structured output");
      }
    }

    return {
      text,
      parsed,
      providerModel: MODEL,
      cachedHit: false,
    };
  }
}

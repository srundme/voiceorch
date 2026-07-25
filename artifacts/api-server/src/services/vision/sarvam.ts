import type { IVisionProvider, VisionAnalysisRequest, VisionAnalysisResult } from "./provider.interface.js";
import { logger } from "../../lib/logger.js";

const SARVAM_VISION_URL = "https://api.sarvam.ai/v1/vision";

export class SarvamVisionProvider implements IVisionProvider {
  readonly name = "sarvam";

  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async analyze(req: VisionAnalysisRequest): Promise<VisionAnalysisResult> {
    let imageBase64: string;
    if (req.imageData) {
      imageBase64 = req.imageData.toString("base64");
    } else if (req.urlRef) {
      // Fetch the image from the URL and encode as base64
      const resp = await fetch(req.urlRef);
      if (!resp.ok) {
        throw new Error(`SarvamVisionProvider: failed to fetch image from URL: ${resp.status} ${resp.statusText}`);
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      imageBase64 = buf.toString("base64");
    } else {
      throw new Error("SarvamVisionProvider: either imageData or urlRef must be provided");
    }

    const body = {
      prompt: req.prompt,
      image: imageBase64,
    };

    const response = await fetch(SARVAM_VISION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      logger.error({ status: response.status, errText }, "SarvamVisionProvider: API error");
      throw new Error(`SarvamVisionProvider: API error ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as { text?: string; result?: string; output?: string };
    const text = data.text ?? data.result ?? data.output ?? "";

    return {
      text,
      parsed: undefined, // Sarvam does not support structured output
      providerModel: "sarvam-vision",
      cachedHit: false,
    };
  }
}

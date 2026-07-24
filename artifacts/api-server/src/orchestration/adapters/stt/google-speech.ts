import type { STTAdapter } from "./base.js";
import type { STTConfig } from "../../types.js";
import { logger } from "../../../lib/logger.js";

/**
 * Google Cloud Speech-to-Text Adapter
 * Uses Google Cloud Speech API (telephony / latest_long / chirp_2) for ultra low-latency, high-accuracy multilingual transcription.
 */
export class GoogleSpeechSTT implements STTAdapter {
  private key: string;
  private model: string;
  private cfg: STTConfig;

  constructor(apiKey: string, model: string | null, cfg: STTConfig) {
    this.key = apiKey;
    this.model = model || "telephony";
    this.cfg = cfg;
  }

  async transcribe(audioBuffer: Buffer, sampleRate = 16000): Promise<string> {
    if (!audioBuffer || audioBuffer.length < 1600) return "";

    const base64Pcm = audioBuffer.toString("base64");
    const primaryLang = this.cfg.language || "hi-IN";
    const altLangs = ["en-IN", "ta-IN", "te-IN", "mr-IN", "bn-IN", "gu-IN", "kn-IN", "ml-IN"].filter(
      (l) => l !== primaryLang,
    );

    const url = `https://speech.googleapis.com/v1/speech:recognize?key=${this.key}`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            encoding: "LINEAR16",
            sampleRateHertz: sampleRate,
            languageCode: primaryLang,
            alternativeLanguageCodes: altLangs,
            model: this.model,
            useEnhanced: true,
          },
          audio: {
            content: base64Pcm,
          },
        }),
      });

      if (!resp.ok) {
        const err = await resp.text().catch(() => "");
        logger.warn({ status: resp.status, err: err.slice(0, 300) }, "Google Speech STT request failed");
        throw new Error(`Google Speech STT error ${resp.status}`);
      }

      const json = (await resp.json()) as {
        results?: Array<{
          alternatives?: Array<{ transcript?: string; confidence?: number }>;
          languageCode?: string;
        }>;
      };

      const transcript = (json.results ?? [])
        .flatMap((r) => r.alternatives ?? [])
        .map((a) => a.transcript ?? "")
        .join(" ")
        .trim();

      logger.info({ transcript, model: this.model }, "Google Speech STT transcribed successfully");
      return transcript;
    } catch (err) {
      logger.warn({ err }, "Google Speech STT transcription failed");
      return "";
    }
  }
}

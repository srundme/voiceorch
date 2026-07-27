import { pcmToWav } from "../../audio.js";
import { geminiThinkingConfig } from "../llm/google.js";
import type { STTAdapter } from "./base.js";
import type { STTConfig } from "../../types.js";
import { logger } from "../../../lib/logger.js";

/**
 * Gemini Direct Audio Input STT Adapter
 * Uses gemini-3.6-flash native audio input capabilities to transcribe speech.
 * Operates as a high-precision batch STT adapter driven by pipeline.ts VAD.
 */
export class GeminiSTT implements STTAdapter {
  private key: string;
  private model: string;
  private cfg: STTConfig;

  constructor(apiKey: string, model: string | null, cfg: STTConfig) {
    this.key = apiKey;
    this.model = model || process.env["VISION_GEMINI_MODEL"] || "gemini-3.6-flash";
    this.cfg = cfg;
  }

  async transcribe(audioBuffer: Buffer, sampleRate = 16000): Promise<string> {
    if (!audioBuffer || audioBuffer.length === 0) return "";
    // Only transcribe if we have at least ~0.15s of audio (2400 bytes at 16kHz PCM16)
    if (audioBuffer.length < 2400) return "";

    const wav = pcmToWav(audioBuffer, sampleRate);
    const base64Wav = wav.toString("base64");

    const prompt = this.cfg.language
      ? `Transcribe the audio accurately in ${this.cfg.language}. Output ONLY the exact transcription text.`
      : "Transcribe the audio accurately. Automatically detect spoken language (English, Hindi, Tamil, Telugu, Marathi, etc.). Output ONLY the exact transcription text.";

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.key}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "audio/wav", data: base64Wav } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 500,
          // In-call STT fallback is latency-sensitive — force minimal/no thinking.
          thinkingConfig: geminiThinkingConfig(this.model),
        },
      }),
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => "");
      logger.warn({ status: resp.status, err: err.slice(0, 300) }, "Gemini STT request failed");
      throw new Error(`Gemini STT error ${resp.status}`);
    }

    const json = (await resp.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const text = (json.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();

    logger.info({ text, bytes: audioBuffer.length }, "Gemini STT speech transcribed successfully");
    return text;
  }
}

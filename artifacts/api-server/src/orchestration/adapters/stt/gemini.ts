import { pcmToWav } from "../../audio.js";
import type { STTAdapter, SttFinalMetadata } from "./base.js";
import type { STTConfig, StreamSTT } from "../../types.js";
import { logger } from "../../../lib/logger.js";

/**
 * Gemini Direct Audio Input STT Adapter
 * Uses gemini-2.5-flash native audio input capabilities to transcribe speech.
 */
export class GeminiSTT implements STTAdapter {
  private key: string;
  private model: string;
  private cfg: STTConfig;

  constructor(apiKey: string, model: string | null, cfg: STTConfig) {
    this.key = apiKey;
    this.model = model || process.env["VISION_GEMINI_MODEL"] || "gemini-2.5-flash";
    this.cfg = cfg;
  }

  async transcribe(audioBuffer: Buffer, sampleRate = 16000): Promise<string> {
    if (!audioBuffer || audioBuffer.length === 0) return "";
    // Only transcribe if we have at least ~0.2s of audio (3200 bytes at 16kHz PCM16)
    if (audioBuffer.length < 3200) return "";

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

    return text;
  }

  transcribeStream(
    onTranscript: (text: string, isFinal: boolean, detectedLanguage?: string, metadata?: SttFinalMetadata) => void,
    onClose?: () => void,
  ): StreamSTT {
    let chunks: Buffer[] = [];
    let isTranscribing = false;

    const processAudioBuffer = async () => {
      if (chunks.length === 0 || isTranscribing) return;
      const audioToTranscribe = Buffer.concat(chunks);
      chunks = []; // Clear queue
      isTranscribing = true;

      try {
        const text = await this.transcribe(audioToTranscribe);
        if (text && text.trim().length > 0) {
          logger.info({ text: text.trim() }, "Gemini STT transcribed speech successfully");
          onTranscript(text.trim(), true, this.cfg.language ?? undefined);
        }
      } catch (err) {
        logger.warn({ err }, "Gemini streaming STT transcribe error");
      } finally {
        isTranscribing = false;
        if (chunks.length > 0) {
          void processAudioBuffer();
        }
      }
    };

    return {
      sendAudio: (audioChunk: Buffer) => {
        if (audioChunk && audioChunk.length > 0) {
          chunks.push(audioChunk);
        }
      },
      flush: () => {
        void processAudioBuffer();
      },
      close: () => {
        void processAudioBuffer().finally(() => {
          onClose?.();
        });
      },
    };
  }
}

import { GoogleGenAI, Modality } from "@google/genai";
import {
  DEFAULT_GEMINI_LIVE_TTS_MODEL,
  resolveGeminiLiveVoice,
} from "./gemini-live-voices.js";

const DEFAULT_PREVIEW_TEXT =
  "Hello! I am your AI voice assistant. I am here to help you today. How can I assist you?";

/**
 * Synthesize a short Gemini TTS preview clip for the voice picker UI.
 * Uses generateContent + responseModalities AUDIO (Interactions API is not used for TTS).
 */
export async function synthesizeGeminiLiveVoicePreview(
  apiKey: string,
  voiceName: string,
  text?: string,
): Promise<Buffer> {
  const ai = new GoogleGenAI({ apiKey });
  const previewText = (text?.slice(0, 200) ?? DEFAULT_PREVIEW_TEXT).trim();
  const voice = resolveGeminiLiveVoice(voiceName);

  const response = await ai.models.generateContent({
    model: DEFAULT_GEMINI_LIVE_TTS_MODEL,
    contents: previewText,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice },
        },
      },
    },
  });

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = (part as { inlineData?: { data?: string; mimeType?: string } }).inlineData;
    if (inline?.data) {
      return Buffer.from(inline.data, "base64");
    }
  }

  throw new Error("Gemini TTS preview returned no audio data");
}

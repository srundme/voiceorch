import { GoogleGenAI } from "@google/genai";
import {
  DEFAULT_GEMINI_LIVE_TTS_MODEL,
  resolveGeminiLiveVoice,
} from "./gemini-live-voices.js";

const DEFAULT_PREVIEW_TEXT =
  "Hello! I am your AI voice assistant. I am here to help you today. How can I assist you?";

/**
 * Synthesize a short Gemini TTS preview clip for the voice picker UI.
 * Returns raw PCM/WAV bytes from the Interactions API.
 */
export async function synthesizeGeminiLiveVoicePreview(
  apiKey: string,
  voiceName: string,
  text?: string,
): Promise<Buffer> {
  const ai = new GoogleGenAI({ apiKey });
  const previewText = (text?.slice(0, 200) ?? DEFAULT_PREVIEW_TEXT).trim();
  const voice = resolveGeminiLiveVoice(voiceName);

  const interaction = await ai.interactions.create({
    model: DEFAULT_GEMINI_LIVE_TTS_MODEL,
    input: previewText,
    response_modalities: ["audio"],
    generation_config: {
      speech_config: [{ voice }],
    },
  });

  const outputs = interaction.outputs ?? [];
  for (const part of outputs) {
    if (part && typeof part === "object" && "type" in part && part.type === "audio") {
      const audio = part as { data?: string; mime_type?: string };
      if (audio.data) {
        return Buffer.from(audio.data, "base64");
      }
    }
  }

  // Fallback: some SDK versions nest audio under content parts
  const anyInteraction = interaction as { output?: unknown };
  if (anyInteraction.output && typeof anyInteraction.output === "object") {
    const out = anyInteraction.output as { data?: string };
    if (out.data) return Buffer.from(out.data, "base64");
  }

  throw new Error("Gemini TTS preview returned no audio data");
}

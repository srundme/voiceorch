import {
  DEFAULT_OPENAI_REALTIME_MODEL,
  resolveOpenAIRealtimeVoice,
} from "./openai-realtime-voices.js";
import { openRealtimeSocket, parseRealtimeEvent, sendRealtimeEvent } from "./openai-realtime-socket.js";

const DEFAULT_PREVIEW_TEXT =
  "Hello! I am your AI voice assistant. I am here to help you today. How can I assist you?";
const PREVIEW_TIMEOUT_MS = 20_000;

/**
 * Synthesize a short preview clip with gpt-realtime itself, so the picker plays
 * the exact voice a call will use. Returns 24 kHz mono PCM16.
 */
export async function synthesizeOpenAIRealtimeVoicePreview(
  apiKey: string,
  voiceName: string,
  text?: string,
): Promise<Buffer> {
  const previewText = (text?.slice(0, 200) ?? DEFAULT_PREVIEW_TEXT).trim();
  const ws = await openRealtimeSocket(apiKey, DEFAULT_OPENAI_REALTIME_MODEL);
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      if (err) reject(err);
      else if (chunks.length === 0) reject(new Error("OpenAI Realtime preview returned no audio"));
      else resolve(Buffer.concat(chunks));
    };
    const timer = setTimeout(() => finish(new Error("OpenAI Realtime preview timed out")), PREVIEW_TIMEOUT_MS);

    ws.on("message", (data) => {
      const evt = parseRealtimeEvent(data);
      if (!evt) return;
      if (evt.type === "response.output_audio.delta" && typeof evt["delta"] === "string") {
        chunks.push(Buffer.from(evt["delta"], "base64"));
      } else if (evt.type === "response.done") {
        finish();
      } else if (evt.type === "error") {
        const message = (evt["error"] as { message?: string } | undefined)?.message ?? "unknown error";
        finish(new Error(`OpenAI Realtime preview error: ${message}`));
      }
    });
    ws.on("error", (err) => finish(err instanceof Error ? err : new Error(String(err))));
    ws.on("close", () => finish());

    sendRealtimeEvent(ws, {
      type: "session.update",
      session: {
        type: "realtime",
        model: DEFAULT_OPENAI_REALTIME_MODEL,
        instructions: "Read the user's text aloud exactly as written. Do not add anything.",
        output_modalities: ["audio"],
        audio: {
          input: { turn_detection: null },
          output: { format: { type: "audio/pcm", rate: 24000 }, voice: resolveOpenAIRealtimeVoice(voiceName) },
        },
      },
    });
    sendRealtimeEvent(ws, {
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: previewText }] },
    });
    sendRealtimeEvent(ws, { type: "response.create" });
  });
}

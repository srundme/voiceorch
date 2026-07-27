import { pcmToWav } from "../../audio.js";
import type { STTAdapter } from "./base.js";
import type { STTConfig } from "../../types.js";

/**
 * Cartesia — Speech-to-Text (Ink, batch endpoint)
 *
 * POST /stt (multipart form) — model must be in the `ink-whisper` family;
 * `language` is ISO-639-1 ("hi", not "hi-IN"). Auth is `Authorization: Bearer`
 * plus a pinned `Cartesia-Version` header (required by API conventions).
 * Response: `{ type, text, duration?, language? }`.
 *
 * NOTE: the previous implementation posted to /v1/audio/transcriptions with
 * model "whisper-1" — an OpenAI-shaped path Cartesia never documented, so
 * batch Cartesia STT could not have worked before this rewrite.
 *
 * Streaming (ink-2 with built-in turn detection) is a separate WS protocol and
 * is not implemented — Cartesia STT is a batch-only provider in this stack.
 */

/** Keep in sync with CARTESIA_VERSION in ../tts/cartesia.ts */
const CARTESIA_VERSION = "2026-03-01";

export class CartesiaSTT implements STTAdapter {
  private key: string;
  private model: string;
  private cfg: STTConfig;

  constructor(apiKey: string, model: string | null, cfg: STTConfig) {
    this.key = apiKey;
    // The batch endpoint only accepts the ink-whisper family — coerce anything
    // else (legacy "whisper-1", streaming-only "ink-2", …).
    this.model = model && model.startsWith("ink-whisper") ? model : "ink-whisper";
    this.cfg = cfg;
  }

  async transcribe(audioBuffer: Buffer, sampleRate = 16000): Promise<string> {
    const wav = pcmToWav(audioBuffer, sampleRate);

    const formData = new FormData();
    const wavAb = new ArrayBuffer(wav.byteLength);
    new Uint8Array(wavAb).set(wav);
    formData.append("file", new Blob([wavAb], { type: "audio/wav" }), "audio.wav");
    formData.append("model", this.model);
    // Cartesia takes ISO-639-1 base codes ("hi"), not BCP-47 ("hi-IN").
    const lang = this.cfg.language?.split("-")[0]?.toLowerCase();
    if (lang) formData.append("language", lang);

    const base = (process.env["CARTESIA_BASE_URL"] ?? "https://api-india.cartesia.ai").replace(/\/+$/, "");
    const resp = await fetch(`${base}/stt`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.key}`,
        "Cartesia-Version": CARTESIA_VERSION,
      },
      body: formData,
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Cartesia STT error ${resp.status}: ${err}`);
    }

    const json = (await resp.json()) as { text?: string };
    return json.text?.trim() ?? "";
  }
}

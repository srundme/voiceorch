import type { TTSAdapter } from "../../types.js";

/**
 * Deepgram Aura TTS — REST API
 * Model: aura-2-en (or any Aura model name passed as voice)
 * Returns raw LINEAR16 PCM at 16 kHz — no conversion needed.
 *
 * Voice/model examples: aura-2-en, aura-asteria-en, aura-luna-en, aura-stella-en
 */

const DEFAULT_MODEL = "aura-2-en";

export class DeepgramTTS implements TTSAdapter {
  private key: string;
  private model: string;

  constructor(apiKey: string, voice: string | null) {
    this.key = apiKey;
    this.model = voice ?? DEFAULT_MODEL;
  }

  async synthesize(text: string): Promise<Buffer> {
    const url = new URL("https://api.deepgram.com/v1/speak");
    url.searchParams.set("model", this.model);
    url.searchParams.set("encoding", "linear16");
    url.searchParams.set("sample_rate", "16000");
    url.searchParams.set("container", "none");

    const resp = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Token ${this.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!resp.ok) throw new Error(`Deepgram TTS ${resp.status}: ${await resp.text()}`);
    return Buffer.from(await resp.arrayBuffer());
  }

  async synthesizeStream(
    text: string,
    onChunk: (chunk: Buffer) => void,
    onDone: () => void,
    signal?: AbortSignal
  ): Promise<void> {
    const url = new URL("https://api.deepgram.com/v1/speak");
    url.searchParams.set("model", this.model);
    url.searchParams.set("encoding", "linear16");
    url.searchParams.set("sample_rate", "16000");
    url.searchParams.set("container", "none");

    const resp = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Token ${this.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
      signal,
    });

    if (!resp.ok) throw new Error(`Deepgram TTS stream ${resp.status}: ${await resp.text()}`);
    if (!resp.body) throw new Error("Deepgram TTS: no response body");

    const reader = resp.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.length) onChunk(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    onDone();
  }
}

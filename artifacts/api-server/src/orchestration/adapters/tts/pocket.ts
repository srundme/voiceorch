import type { TTSAdapter } from "../../types.js";

function voiceCpuUrl(): string {
  return (process.env["VOICE_CPU_URL"] || "http://127.0.0.1:8090").replace(/\/$/, "");
}

/**
 * Pocket TTS on the CPU voice service.
 * Response is 16 kHz 16-bit mono PCM, framed in 20 ms chunks.
 */
export class PocketTTS implements TTSAdapter {
  async synthesize(text: string): Promise<{ audio: Buffer; characters: number }> {
    const chunks: Buffer[] = [];
    await this.synthesizeStream(text, (chunk) => chunks.push(chunk), () => undefined);
    return { audio: Buffer.concat(chunks), characters: text.length };
  }

  async synthesizeStream(
    text: string,
    onChunk: (chunk: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const resp = await fetch(`${voiceCpuUrl()}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
    if (!resp.ok) throw new Error(`Pocket TTS ${resp.status}: ${await resp.text()}`);
    if (!resp.body) throw new Error("Pocket TTS: no response body");
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
    onDone(text.length);
  }
}

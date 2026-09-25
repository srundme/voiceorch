import type { TTSAdapter } from "../../types.js";
import { irfanPodBaseUrl } from "../irfan-pod-url.js";

/** Speaks with the cloned Irfan voice loaded on the GPU pod. Returns 16 kHz PCM. */
export class IrfanPodTTS implements TTSAdapter {
  constructor(
    private readonly _key: string,
    private readonly _voice: string | null,
    private readonly _model: string | null,
  ) {}

  private request(text: string, signal?: AbortSignal): Promise<Response> {
    return fetch(`${irfanPodBaseUrl()}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: text }),
      signal,
    });
  }

  async synthesize(text: string): Promise<{ audio: Buffer; characters: number }> {
    const resp = await this.request(text);
    if (!resp.ok) {
      throw new Error(`Irfan pod TTS HTTP ${resp.status}`);
    }
    const audio = Buffer.from(await resp.arrayBuffer());
    return { audio, characters: text.length };
  }

  /** The pod streams PCM as the voice model makes it; forward whole samples only. */
  async synthesizeStream(
    text: string,
    onChunk: (pcm16k: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const resp = await this.request(text, signal);
    if (!resp.ok) {
      throw new Error(`Irfan pod TTS HTTP ${resp.status}`);
    }
    if (!resp.body) throw new Error("Irfan pod TTS: no response body");

    const reader = resp.body.getReader();
    let carry: Buffer = Buffer.alloc(0);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.length) continue;
        const pcm = carry.length ? Buffer.concat([carry, Buffer.from(value)]) : Buffer.from(value);
        const even = pcm.length - (pcm.length % 2);
        carry = pcm.subarray(even);
        if (even > 0) onChunk(pcm.subarray(0, even));
      }
    } finally {
      reader.releaseLock();
    }
    onDone(text.length);
  }
}

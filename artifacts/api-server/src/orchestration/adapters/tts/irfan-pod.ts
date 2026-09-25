import type { TTSAdapter } from "../../types.js";
import { irfanPodBaseUrl } from "../irfan-pod-url.js";

/** Speaks with the cloned Irfan voice loaded on the GPU pod. Returns 16 kHz PCM. */
export class IrfanPodTTS implements TTSAdapter {
  constructor(
    private readonly _key: string,
    private readonly _voice: string | null,
    private readonly _model: string | null,
  ) {}

  async synthesize(text: string): Promise<{ audio: Buffer; characters: number }> {
    const resp = await fetch(`${irfanPodBaseUrl()}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: text }),
    });
    if (!resp.ok) {
      throw new Error(`Irfan pod TTS HTTP ${resp.status}`);
    }
    const audio = Buffer.from(await resp.arrayBuffer());
    return { audio, characters: text.length };
  }
}

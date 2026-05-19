import { pcmToWav } from "../../audio.js";
import type { STTAdapter } from "./base.js";
import type { STTConfig } from "../../types.js";

/**
 * AssemblyAI — REST transcription
 * Docs: https://www.assemblyai.com/docs
 * Supports models: best, nano
 */
export class AssemblyAISTT implements STTAdapter {
  private key: string;
  private model: string;
  private cfg: STTConfig;

  constructor(apiKey: string, model: string | null, cfg: STTConfig) {
    this.key = apiKey;
    this.model = model ?? "best";
    this.cfg = cfg;
  }

  async transcribe(audioBuffer: Buffer, sampleRate = 16000): Promise<string> {
    const wav = pcmToWav(audioBuffer, sampleRate);

    // Step 1: Upload audio
    const uploadResp = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: {
        Authorization: this.key,
        "Content-Type": "application/octet-stream",
      },
      body: wav,
    });

    if (!uploadResp.ok) throw new Error(`AssemblyAI upload error: ${uploadResp.status}`);
    const { upload_url } = (await uploadResp.json()) as { upload_url: string };

    // Step 2: Submit transcription
    const body: Record<string, unknown> = {
      audio_url: upload_url,
      speech_model: this.model,
    };

    if (this.cfg.language) body.language_code = this.cfg.language;
    if (this.cfg.keyterms.length > 0) body.word_boost = this.cfg.keyterms;

    const transcriptResp = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: {
        Authorization: this.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!transcriptResp.ok) throw new Error(`AssemblyAI transcript error: ${transcriptResp.status}`);
    const { id } = (await transcriptResp.json()) as { id: string };

    // Step 3: Poll for completion (max 30s)
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const pollResp = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
        headers: { Authorization: this.key },
      });
      const result = (await pollResp.json()) as { status: string; text?: string; confidence?: number };
      if (result.status === "completed") {
        if (
          result.confidence !== undefined &&
          result.confidence < this.cfg.confidenceThreshold
        ) {
          return "";
        }
        return result.text?.trim() ?? "";
      }
      if (result.status === "error") throw new Error("AssemblyAI transcription failed");
    }

    throw new Error("AssemblyAI transcription timed out");
  }
}

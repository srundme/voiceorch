import type { TTSAdapter } from "../../types.js";

/**
 * Sarvam AI — Text-to-Speech (Bulbul model)
 * Docs: https://docs.sarvam.ai/api-reference/text-to-speech
 *
 * Non-streaming: POST /text-to-speech  → { audios: [base64_wav] }
 * Streaming     : POST /text-to-speech-streaming  → chunked binary (WAV stream)
 *   Streaming requires Sarvam Pro plan.
 */

const BASE = "https://api.sarvam.ai";
const WAV_HEADER_BYTES = 44; // standard RIFF/WAV header size

/** Maps BCP-47 / short codes stored on agents → Sarvam target_language_code */
const SARVAM_LANG: Record<string, string> = {
  "en":    "en-IN", "en-IN": "en-IN", "en-US": "en-IN", "en-GB": "en-IN",
  "ta":    "ta-IN", "ta-IN": "ta-IN",
  "hi":    "hi-IN", "hi-IN": "hi-IN",
  "te":    "te-IN", "te-IN": "te-IN",
  "kn":    "kn-IN", "kn-IN": "kn-IN",
  "mr":    "mr-IN", "mr-IN": "mr-IN",
  "gu":    "gu-IN", "gu-IN": "gu-IN",
  "bn":    "bn-IN", "bn-IN": "bn-IN",
  "ml":    "ml-IN", "ml-IN": "ml-IN",
  "pa":    "pa-IN", "pa-IN": "pa-IN",
  "or":    "or-IN", "or-IN": "or-IN",
};

/** Default speaker per language (female, language-native) */
const DEFAULT_SPEAKER: Record<string, string> = {
  "en-IN": "meera",   "ta-IN": "meera",    "hi-IN": "maitreyi",
  "te-IN": "pavithra","kn-IN": "meera",    "mr-IN": "meera",
  "gu-IN": "meera",   "bn-IN": "meera",    "ml-IN": "meera",
  "pa-IN": "meera",   "or-IN": "meera",
};

export class SarvamTTS implements TTSAdapter {
  private key: string;
  private speaker: string;
  private model: string;
  private langCode: string;

  constructor(
    apiKey: string,
    voice: string | null,
    extraConfig?: string | null,
    language?: string | null,
  ) {
    this.key = apiKey;

    // Language resolution: explicit language param > extraConfig.language > default
    let lang = language ?? null;
    if (!lang && extraConfig) {
      try {
        const cfg = JSON.parse(extraConfig) as { language?: string };
        lang = cfg.language ?? null;
      } catch {
        // ignore malformed extraConfig
      }
    }
    this.langCode = (lang && SARVAM_LANG[lang]) ? SARVAM_LANG[lang]! : "en-IN";
    this.speaker = (voice && !voice.includes("-")) ? voice : (DEFAULT_SPEAKER[this.langCode] ?? "meera");
    this.model = "bulbul:v2";
  }

  /** Hot-swap the TTS language mid-call (multilingual mode). */
  setLanguage(lang: string): void {
    this.langCode = SARVAM_LANG[lang] ?? SARVAM_LANG[lang.split("-")[0]!] ?? "en-IN";
  }

  private get requestBody() {
    return {
      inputs: ["__TEXT__"],  // placeholder — replaced per call
      target_language_code: this.langCode,
      speaker: this.speaker,
      model: this.model,
      enable_preprocessing: true,
      speech_sample_rate: 16000,
    };
  }

  private get headers() {
    return {
      "api-subscription-key": this.key,
      "Content-Type": "application/json",
    };
  }

  /** Buffered synthesis — returns full PCM after decoding base64 WAV response. */
  async synthesize(text: string): Promise<{ audio: Buffer; characters: number }> {
    const resp = await fetch(`${BASE}/text-to-speech`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ ...this.requestBody, inputs: [text] }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Sarvam TTS error ${resp.status}: ${err}`);
    }

    const json = (await resp.json()) as { audios?: string[] };
    if (!json.audios?.[0]) throw new Error("Sarvam TTS: no audio in response");

    // Response is base64-encoded WAV; strip the 44-byte RIFF/WAV header → raw PCM s16le@16kHz
    const wav = Buffer.from(json.audios[0], "base64");
    return { audio: wav.slice(WAV_HEADER_BYTES), characters: text.length };
  }

  /**
   * Streaming synthesis (Pro plan) — streams chunked WAV audio.
   * The response is a WAV stream: first bytes contain the RIFF header (44 bytes),
   * followed by raw PCM s16le at 16kHz. We detect and strip the header from the
   * first chunk, then forward all subsequent bytes directly as PCM.
   */
  async synthesizeStream(
    text: string,
    onChunk: (pcm16k: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const resp = await fetch(`${BASE}/text-to-speech-streaming`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ ...this.requestBody, inputs: [text] }),
      signal,
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Sarvam TTS stream error ${resp.status}: ${err}`);
    }

    if (!resp.body) throw new Error("Sarvam TTS: no response body for streaming");

    const reader = resp.body.getReader();
    let headerSkipped = 0;
    let isWav: boolean | null = null; // null = not yet determined

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.length) continue;

        let chunk = Buffer.from(value);

        // Detect WAV header on the very first chunk ("RIFF" magic bytes)
        if (isWav === null) {
          isWav =
            chunk.length >= 4 &&
            chunk[0] === 0x52 && // R
            chunk[1] === 0x49 && // I
            chunk[2] === 0x46 && // F
            chunk[3] === 0x46;   // F
        }

        // Strip WAV header bytes (may span multiple chunks if chunk < 44 bytes)
        if (isWav && headerSkipped < WAV_HEADER_BYTES) {
          const skip = Math.min(WAV_HEADER_BYTES - headerSkipped, chunk.length);
          chunk = chunk.slice(skip);
          headerSkipped += skip;
        }

        if (chunk.length > 0) onChunk(chunk);
      }
    } finally {
      reader.releaseLock();
    }

    onDone(text.length);
  }
}

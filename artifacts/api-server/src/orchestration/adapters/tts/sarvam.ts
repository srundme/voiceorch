import type { TTSAdapter } from "../../types.js";

/**
 * Sarvam AI — Text-to-Speech (Bulbul model)
 * Docs: https://docs.sarvam.ai/api-reference/text-to-speech
 *
 * Valid models (as of Jun 2026): bulbul:v3 (default), bulbul:v3-beta, bulbul:v2
 * bulbul:v1 is no longer accepted by the API.
 *
 * Speaker sets differ by model:
 *   bulbul:v2  — anushka, abhilash, manisha, vidya, arya, karun, hitesh  (7 voices)
 *   bulbul:v3  — ritu, aditya, priya, neha, rahul, pooja, rohan, simran,
 *                kavya, amit, dev, ishita, shreya, ratan, varun, manan,
 *                sumit, roopa, kabir, aayan, shubh, ashutosh, advait, anand,
 *                tanya, tarun, sunny, mani, gokul, vijay, shruti, suhani,
 *                mohit, kavitha, rehan, soham, rupali  (38 voices)
 *
 * The streaming endpoint /text-to-speech-streaming does NOT yet exist (returns 404).
 * Only the buffered synthesize() path is implemented.
 */

const BASE = "https://api.sarvam.ai";
const WAV_HEADER_BYTES = 44;

const VALID_MODELS = new Set(["bulbul:v3", "bulbul:v3-beta", "bulbul:v2"]);

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

/** Default speaker per model when none is explicitly set */
const DEFAULT_SPEAKER: Record<string, string> = {
  "bulbul:v3":      "ritu",
  "bulbul:v3-beta": "ritu",
  "bulbul:v2":      "anushka",
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
    model?: string | null,
  ) {
    this.key = apiKey;

    // Model resolution: explicit param > valid extraConfig.model > default bulbul:v3
    this.model = (model && VALID_MODELS.has(model)) ? model : "bulbul:v3";

    // Language resolution: explicit language param > extraConfig.language > en-IN
    let lang = language ?? null;
    if (!lang && extraConfig) {
      try {
        const cfg = JSON.parse(extraConfig) as { language?: string; model?: string };
        lang = cfg.language ?? null;
        // Legacy extraConfig may carry model too
        if (cfg.model && VALID_MODELS.has(cfg.model)) this.model = cfg.model;
      } catch {
        // ignore malformed extraConfig
      }
    }
    this.langCode = (lang && SARVAM_LANG[lang]) ? SARVAM_LANG[lang]! : "en-IN";
    this.speaker = (voice && !voice.includes("-")) ? voice : (DEFAULT_SPEAKER[this.model] ?? "ritu");
  }

  /** Hot-swap the TTS language mid-call (multilingual mode). */
  setLanguage(lang: string): void {
    this.langCode = SARVAM_LANG[lang] ?? SARVAM_LANG[lang.split("-")[0]!] ?? "en-IN";
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
      body: JSON.stringify({
        inputs: [text],
        target_language_code: this.langCode,
        speaker: this.speaker,
        model: this.model,
        enable_preprocessing: true,
        speech_sample_rate: 16000,
      }),
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
}

import type { TTSAdapter } from "../../types.js";

/**
 * Sarvam AI — Text-to-Speech (Bulbul model)
 * Docs: https://docs.sarvam.ai/api-reference/text-to-speech
 * Models: bulbul:v1, bulbul:v2
 * Returns base64-encoded WAV audio
 */
/** Maps BCP-47 / short codes stored on agents → Sarvam target_language_code */
const SARVAM_LANG: Record<string, string> = {
  "ta": "ta-IN", "ta-IN": "ta-IN",
  "hi": "hi-IN", "hi-IN": "hi-IN",
  "te": "te-IN", "te-IN": "te-IN",
  "kn": "kn-IN", "kn-IN": "kn-IN",
  "mr": "mr-IN", "mr-IN": "mr-IN",
  "gu": "gu-IN", "gu-IN": "gu-IN",
  "bn": "bn-IN", "bn-IN": "bn-IN",
  "ml": "ml-IN", "ml-IN": "ml-IN",
  "pa": "pa-IN", "pa-IN": "pa-IN",
};

/** Default Sarvam speaker per language (female, language-native) */
const SARVAM_DEFAULT_SPEAKER: Record<string, string> = {
  "ta-IN": "meera", "hi-IN": "maitreyi", "te-IN": "pavithra",
  "kn-IN": "meera",  "mr-IN": "meera",   "gu-IN": "meera",
  "bn-IN": "meera",  "ml-IN": "meera",   "pa-IN": "meera",
};

export class SarvamTTS implements TTSAdapter {
  private key: string;
  private speaker: string;
  private model: string;
  private langCode: string;

  constructor(apiKey: string, voice: string | null, extraConfig?: string | null) {
    this.key = apiKey;
    const cfg = extraConfig ? (JSON.parse(extraConfig) as { language?: string }) : {};
    this.langCode = SARVAM_LANG[cfg.language ?? ""] ?? "en-IN";
    this.speaker = (voice && !voice.includes("-")) ? voice : (SARVAM_DEFAULT_SPEAKER[this.langCode] ?? "meera");
    this.model = "bulbul:v2";
  }

  async synthesize(text: string): Promise<{ audio: Buffer; characters: number }> {
    const resp = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "api-subscription-key": this.key,
        "Content-Type": "application/json",
      },
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

    // Audios are base64-encoded WAV; strip the WAV header (44 bytes) to get raw PCM
    const wav = Buffer.from(json.audios[0], "base64");
    return { audio: wav.slice(44), characters: text.length }; // strip WAV header → raw PCM s16le at 16kHz
  }
}

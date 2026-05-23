import { pcmToWav } from "../../audio.js";
import type { STTAdapter } from "./base.js";
import type { STTConfig } from "../../types.js";

/**
 * Sarvam AI — Speech-to-Text (saarika model)
 * Docs: https://docs.sarvam.ai/api-reference/speech-to-text
 */
const VALID_SARVAM_STT_MODELS = new Set([
  "saarika:v2.5", "saarika:v2", "saarika:v1", "saarika:flash",
  "saaras:v3", "saaras:v3-realtime",
]);
const DEFAULT_SARVAM_STT_MODEL = "saarika:v2.5";

/** All language codes Sarvam accepts (BCP 47 with -IN region). */
const VALID_SARVAM_LANG = new Set([
  "unknown",
  "hi-IN", "bn-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN",
  "pa-IN", "ta-IN", "te-IN", "en-IN", "gu-IN", "as-IN",
  "ur-IN", "ne-IN", "kok-IN", "ks-IN", "sd-IN", "sa-IN",
  "sat-IN", "mni-IN", "brx-IN", "mai-IN", "doi-IN",
]);

/** Map bare ISO-639-1 codes → Sarvam BCP 47 equivalents. */
const LANG_REMAP: Record<string, string> = {
  en: "en-IN", hi: "hi-IN", bn: "bn-IN", kn: "kn-IN",
  ml: "ml-IN", mr: "mr-IN", pa: "pa-IN", ta: "ta-IN",
  te: "te-IN", gu: "gu-IN", ur: "ur-IN",
};

function normaliseSarvamLang(code: string | null): string {
  if (!code) return "en-IN";
  if (VALID_SARVAM_LANG.has(code)) return code;
  const remapped = LANG_REMAP[code.toLowerCase()];
  if (remapped) return remapped;
  // Try appending -IN (e.g. "od" → "od-IN")
  const withIN = `${code}-IN`;
  if (VALID_SARVAM_LANG.has(withIN)) return withIN;
  return "en-IN";   // safe fallback
}

export class SarvamSTT implements STTAdapter {
  private key: string;
  private model: string;
  private langCode: string;

  constructor(apiKey: string, model: string | null, cfg: STTConfig) {
    this.key = apiKey;
    const candidate = model ?? "";
    this.model = VALID_SARVAM_STT_MODELS.has(candidate) ? candidate : DEFAULT_SARVAM_STT_MODEL;
    this.langCode = normaliseSarvamLang(cfg.language);
  }

  async transcribe(audioBuffer: Buffer, sampleRate = 16000): Promise<string> {
    const wav = pcmToWav(audioBuffer, sampleRate);

    const formData = new FormData();
    const wavAb = new ArrayBuffer(wav.byteLength);
    new Uint8Array(wavAb).set(wav);
    formData.append("file", new Blob([wavAb], { type: "audio/wav" }), "audio.wav");
    formData.append("model", this.model);
    formData.append("language_code", this.langCode);

    const resp = await fetch("https://api.sarvam.ai/speech-to-text", {
      method: "POST",
      headers: { "api-subscription-key": this.key },
      body: formData,
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Sarvam STT error ${resp.status}: ${err}`);
    }

    const json = (await resp.json()) as { transcript?: string };
    return json.transcript?.trim() ?? "";
  }
}

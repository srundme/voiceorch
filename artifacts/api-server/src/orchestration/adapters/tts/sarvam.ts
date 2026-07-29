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
 * Speed control: only `pace` is supported (0.5–2.0 documented range); pitch and
 * loudness are REJECTED by bulbul:v3 with a 400 — never send them.
 *
 * The streaming endpoint /text-to-speech-streaming does NOT yet exist (returns 404).
 * Only the buffered synthesize() path is implemented.
 */

const BASE = "https://api.sarvam.ai";
const WAV_HEADER_BYTES = 44;

/** REST /text-to-speech caps input at 2,500 characters — stay under with margin. */
const MAX_TTS_CHARS = 2400;

const VALID_MODELS = new Set(["bulbul:v3", "bulbul:v3-beta", "bulbul:v2"]);

/** Maps BCP-47 / short codes stored on agents → Sarvam target_language_code.
 *  Note: Odia is od-IN on Sarvam (the BCP-47 or-IN is rejected). */
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
  "or":    "od-IN", "or-IN": "od-IN", "od": "od-IN", "od-IN": "od-IN",
};

/** Default speaker per model when none is explicitly set */
const DEFAULT_SPEAKER: Record<string, string> = {
  "bulbul:v3":      "ritu",
  "bulbul:v3-beta": "ritu",
  "bulbul:v2":      "anushka",
};

/** v2 speakers are rejected by bulbul:v3 with HTTP 400 — lock by model. */
const V2_SPEAKERS = new Set([
  "anushka", "abhilash", "manisha", "vidya", "arya", "karun", "hitesh",
]);

function resolveSpeaker(voice: string | null, model: string): string {
  const fallback = DEFAULT_SPEAKER[model] ?? "ritu";
  if (!voice || voice.includes("-")) return fallback;
  if (model === "bulbul:v2") return V2_SPEAKERS.has(voice) ? voice : fallback;
  // v3 / v3-beta: never send a v2 speaker (API 400)
  if (V2_SPEAKERS.has(voice)) return fallback;
  return voice;
}

export class SarvamTTS implements TTSAdapter {
  private key: string;
  private speaker: string;
  private model: string;
  private langCode: string;
  private pace: number | null;

  constructor(
    apiKey: string,
    voice: string | null,
    extraConfig?: string | null,
    language?: string | null,
    model?: string | null,
    speed?: number | null,
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
    this.speaker = resolveSpeaker(voice, this.model);

    // Agent ttsSpeed → Bulbul `pace`, clamped to the documented 0.5–2.0 range.
    // Omitted at (near-)1.0 so default-speed agents keep byte-identical requests.
    this.pace = (typeof speed === "number" && Number.isFinite(speed))
      ? Math.min(2, Math.max(0.5, speed))
      : null;
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

  /** Split oversized text at whitespace boundaries (hard-cut only if a run has
   *  no spaces). The pipeline sends sentence-sized jobs, so this is a safety
   *  net for very long greetings/monologues that would otherwise 400. */
  private static splitForLimit(text: string): string[] {
    if (text.length <= MAX_TTS_CHARS) return [text];
    const parts: string[] = [];
    let rest = text;
    while (rest.length > MAX_TTS_CHARS) {
      let cut = rest.lastIndexOf(" ", MAX_TTS_CHARS);
      if (cut < MAX_TTS_CHARS / 2) cut = MAX_TTS_CHARS;   // no usable space — hard cut
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trimStart();
    }
    if (rest) parts.push(rest);
    return parts.filter((p) => p.length > 0);
  }

  /** Synthesize one ≤2,400-char part → raw PCM s16le@16kHz (WAV header stripped). */
  private async synthesizeOne(text: string): Promise<Buffer> {
    const body: Record<string, unknown> = {
      inputs: [text],
      target_language_code: this.langCode,
      speaker: this.speaker,
      model: this.model,
      enable_preprocessing: true,
      speech_sample_rate: 16000,
    };
    if (this.pace !== null && Math.abs(this.pace - 1) > 0.001) body["pace"] = this.pace;

    const resp = await fetch(`${BASE}/text-to-speech`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Sarvam TTS error ${resp.status}: ${err}`);
    }

    const json = (await resp.json()) as { audios?: string[] };
    if (!json.audios?.[0]) throw new Error("Sarvam TTS: no audio in response");

    // Response is base64-encoded WAV; strip the 44-byte RIFF/WAV header → raw PCM s16le@16kHz
    const wav = Buffer.from(json.audios[0], "base64");
    return wav.slice(WAV_HEADER_BYTES);
  }

  /** Buffered synthesis — returns full PCM after decoding base64 WAV response(s). */
  async synthesize(text: string): Promise<{ audio: Buffer; characters: number }> {
    const parts = SarvamTTS.splitForLimit(text);
    const buffers: Buffer[] = [];
    for (const part of parts) buffers.push(await this.synthesizeOne(part));
    return {
      audio: buffers.length === 1 ? buffers[0]! : Buffer.concat(buffers),
      characters: text.length,
    };
  }
}

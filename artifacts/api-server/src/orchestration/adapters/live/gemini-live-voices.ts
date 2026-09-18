export interface GeminiLiveVoice {
  name: string;
  style: string;
}

/** 30 preset voices supported by Gemini Live + TTS (Google docs, 2026). */
export const GEMINI_LIVE_VOICES: readonly GeminiLiveVoice[] = [
  { name: "Zephyr", style: "Bright" },
  { name: "Puck", style: "Upbeat" },
  { name: "Charon", style: "Informative" },
  { name: "Kore", style: "Firm" },
  { name: "Fenrir", style: "Excitable" },
  { name: "Leda", style: "Youthful" },
  { name: "Orus", style: "Firm" },
  { name: "Aoede", style: "Breezy" },
  { name: "Callirrhoe", style: "Easy-going" },
  { name: "Autonoe", style: "Bright" },
  { name: "Enceladus", style: "Breathy" },
  { name: "Iapetus", style: "Clear" },
  { name: "Umbriel", style: "Easy-going" },
  { name: "Algieba", style: "Smooth" },
  { name: "Despina", style: "Smooth" },
  { name: "Erinome", style: "Clear" },
  { name: "Algenib", style: "Gravelly" },
  { name: "Rasalgethi", style: "Informative" },
  { name: "Laomedeia", style: "Upbeat" },
  { name: "Achernar", style: "Soft" },
  { name: "Alnilam", style: "Firm" },
  { name: "Schedar", style: "Even" },
  { name: "Gacrux", style: "Mature" },
  { name: "Pulcherrima", style: "Forward" },
  { name: "Achird", style: "Friendly" },
  { name: "Zubenelgenubi", style: "Casual" },
  { name: "Vindemiatrix", style: "Gentle" },
  { name: "Sadachbia", style: "Lively" },
  { name: "Sadaltager", style: "Knowledgeable" },
  { name: "Sulafat", style: "Warm" },
] as const;

export const DEFAULT_GEMINI_LIVE_MODEL = "gemini-3.1-flash-live-preview";
export const DEFAULT_GEMINI_LIVE_TTS_MODEL = "gemini-3.1-flash-tts-preview";
export const DEFAULT_GEMINI_LIVE_VOICE = "Kore";

const DEPRECATED_LIVE_MODELS = new Set([
  "gemini-2.5-flash-native-audio-preview-12-2025",
  "gemini-2.5-flash-native-audio-preview-09-2025",
  "gemini-2.0-flash-live-001",
  "gemini-live-2.5-flash-preview",
]);

/** Map stored/legacy Live model IDs onto the current voice-agent model. */
export function resolveGeminiLiveModel(raw: string | undefined | null): string {
  const t = (raw ?? "").trim();
  if (!t || DEPRECATED_LIVE_MODELS.has(t) || t.includes("native-audio") || t.includes("2.5-flash-live") || t.includes("2.0-flash-live")) {
    return DEFAULT_GEMINI_LIVE_MODEL;
  }
  return t;
}

const VOICE_NAME_SET = new Set(GEMINI_LIVE_VOICES.map((v) => v.name));

export function isValidGeminiLiveVoice(name: string): boolean {
  return VOICE_NAME_SET.has(name);
}

export function resolveGeminiLiveVoice(name: string | undefined | null): string {
  if (name && isValidGeminiLiveVoice(name)) return name;
  return DEFAULT_GEMINI_LIVE_VOICE;
}

export type GeminiLiveThinkingLevel = "minimal" | "low" | "medium" | "high";

export function resolveGeminiLiveThinkingLevel(
  level: string | undefined | null,
): GeminiLiveThinkingLevel {
  if (level === "low" || level === "medium" || level === "high") return level;
  return "minimal";
}

export type VoiceStackId = "classic" | "gemini_live";

export function resolveVoiceStack(raw: string | undefined | null): VoiceStackId {
  return raw === "gemini_live" ? "gemini_live" : "classic";
}

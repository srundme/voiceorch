/** Preset voices accepted by gpt-realtime (`audio.output.voice`). */
export const OPENAI_REALTIME_VOICES: readonly string[] = [
  "marin",
  "cedar",
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
] as const;

export const DEFAULT_OPENAI_REALTIME_MODEL = "gpt-realtime";
export const DEFAULT_OPENAI_REALTIME_VOICE = "marin";
export const OPENAI_REALTIME_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";

export function resolveOpenAIRealtimeModel(_raw: string | undefined | null): string {
  return DEFAULT_OPENAI_REALTIME_MODEL;
}

const VOICE_NAME_SET = new Set(OPENAI_REALTIME_VOICES);

export function isValidOpenAIRealtimeVoice(name: string): boolean {
  return VOICE_NAME_SET.has(name);
}

export function resolveOpenAIRealtimeVoice(name: string | undefined | null): string {
  if (name && isValidOpenAIRealtimeVoice(name)) return name;
  return DEFAULT_OPENAI_REALTIME_VOICE;
}

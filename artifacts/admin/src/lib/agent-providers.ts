export const ASR_PROVIDERS = [
  { value: "deepgram",   label: "Deepgram Nova" },
  { value: "azure",      label: "Azure Speech" },
  { value: "assemblyai", label: "AssemblyAI" },
  { value: "sarvam",     label: "Sarvam (Saarika)" },
  { value: "cartesia",   label: "Cartesia" },
];

export const LLM_PROVIDERS = [
  { value: "openai",    label: "OpenAI" },
  { value: "anthropic", label: "Anthropic Claude" },
  { value: "google",    label: "Google Gemini" },
  { value: "deepseek",  label: "DeepSeek" },
  { value: "mistral",   label: "Mistral AI" },
  { value: "cohere",    label: "Cohere" },
  { value: "qwen",      label: "Qwen (via Groq)" },
  { value: "groq",      label: "Groq" },
  { value: "sarvam",    label: "Sarvam" },
];

export const TTS_PROVIDERS = [
  { value: "elevenlabs",    label: "ElevenLabs" },
  { value: "openai_tts",    label: "OpenAI TTS" },
  { value: "cartesia",      label: "Cartesia (Sonic)" },
  { value: "deepgram_aura", label: "Deepgram Aura" },
  { value: "azure_tts",     label: "Azure TTS" },
  { value: "sarvam",        label: "Sarvam (Bulbul)" },
];

export const TELEPHONY_PROVIDERS = [
  { value: "twilio", label: "Twilio" },
  { value: "plivo",  label: "Plivo" },
  { value: "vobiz",  label: "Vobiz" },
];

export const ASR_MODELS: Record<string, { value: string; label: string }[]> = {
  deepgram:   [{ value: "nova-2", label: "Nova-2 (recommended)" }, { value: "nova-2-phonecall", label: "Nova-2 Phone Call" }, { value: "nova-2-meeting", label: "Nova-2 Meeting" }, { value: "whisper-large", label: "Whisper Large" }],
  azure:      [{ value: "en-US-standard", label: "en-US-standard" }, { value: "en-US-enhanced", label: "en-US-enhanced" }, { value: "en-IN-standard", label: "en-IN-standard" }],
  assemblyai: [{ value: "best", label: "Best (default)" }, { value: "nano", label: "Nano (fast)" }],
  sarvam:     [
    { value: "saaras:v3",     label: "Saaras v3 — real-time streaming (recommended)" },
    { value: "saarika:v2.5",  label: "Saarika v2.5 — batch (accurate)" },
    { value: "saarika:flash", label: "Saarika Flash — batch (fast, deprecated)" },
  ],
  cartesia:   [{ value: "sonic-english", label: "Sonic English" }, { value: "sonic-multilingual", label: "Sonic Multilingual" }],
};

export const LLM_MODELS: Record<string, { value: string; label: string }[]> = {
  openai:    [{ value: "gpt-4o-mini", label: "GPT-4o Mini" }, { value: "gpt-4o", label: "GPT-4o" }, { value: "gpt-4-turbo", label: "GPT-4 Turbo" }, { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" }],
  anthropic: [{ value: "claude-opus-4-5", label: "Claude Opus 4 (best)" }, { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" }, { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku (fast)" }],
  google:    [{ value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (recommended)" }, { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" }, { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite (fast)" }, { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" }],
  deepseek:  [{ value: "deepseek-chat", label: "DeepSeek V3 (chat)" }, { value: "deepseek-reasoner", label: "DeepSeek R1 (reasoner)" }],
  mistral:   [{ value: "mistral-large-latest", label: "Mistral Large (best)" }, { value: "mistral-small-latest", label: "Mistral Small (fast)" }],
  cohere:    [{ value: "command-r-plus-08-2024", label: "Command R+ (best)" }, { value: "command-r-08-2024", label: "Command R" }],
  qwen:      [{ value: "qwen/qwen3-32b", label: "Qwen 3 32B (recommended)" }, { value: "qwen/qwen3-235b-a22b", label: "Qwen 3 235B" }],
  groq:      [{ value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (recommended)" }, { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B (fast)" }, { value: "gemma2-9b-it", label: "Gemma 2 9B" }],
  sarvam:    [{ value: "sarvam-30b", label: "Sarvam 30B (recommended)" }, { value: "sarvam-105b", label: "Sarvam 105B" }],
};

export const TTS_MODELS: Record<string, { value: string; label: string }[]> = {
  cartesia: [
    { value: "sonic-3.5",   label: "Sonic 3.5 ✦ New — 42 languages, lowest latency" },
    { value: "sonic-3",     label: "Sonic 3" },
    { value: "sonic-2",     label: "Sonic 2 (stable)" },
    { value: "sonic-turbo", label: "Sonic Turbo (fast, low-latency)" },
  ],
};

export const TTS_VOICES: Record<string, { value: string; label: string }[] | null> = {
  elevenlabs:    null,
  cartesia:      null,
  azure_tts:     null,
  openai_tts: [
    { value: "alloy",   label: "Alloy (neutral)" },
    { value: "ash",     label: "Ash (warm)" },
    { value: "coral",   label: "Coral (friendly)" },
    { value: "echo",    label: "Echo (deep)" },
    { value: "fable",   label: "Fable (expressive)" },
    { value: "onyx",    label: "Onyx (authoritative)" },
    { value: "nova",    label: "Nova (energetic)" },
    { value: "sage",    label: "Sage (calm)" },
    { value: "shimmer", label: "Shimmer (clear)" },
  ],
  deepgram_aura: [
    { value: "aura-2-en",       label: "Aura 2 (default)" },
    { value: "aura-asteria-en", label: "Asteria (warm female)" },
    { value: "aura-luna-en",    label: "Luna (soft female)" },
    { value: "aura-stella-en",  label: "Stella (bright female)" },
    { value: "aura-zeus-en",    label: "Zeus (deep male)" },
    { value: "aura-orion-en",   label: "Orion (male)" },
  ],
  sarvam: [
    { value: "meera",    label: "Meera (female)" },
    { value: "pavithra", label: "Pavithra (female)" },
    { value: "maitreyi", label: "Maitreyi (female)" },
    { value: "arvind",   label: "Arvind (male)" },
    { value: "amol",     label: "Amol (male)" },
    { value: "amartya",  label: "Amartya (male)" },
    { value: "neel",     label: "Neel (male)" },
    { value: "misha",    label: "Misha (female)" },
    { value: "arjun",    label: "Arjun (male)" },
    { value: "maya",     label: "Maya (female)" },
  ],
};

export function getModelError(
  provider: string,
  model: string | undefined,
  catalogue: Record<string, { value: string; label: string }[]>,
): string | null {
  const known = catalogue[provider];
  if (!known || !model) return null;
  return known.some(m => m.value === model)
    ? null
    : `"${model}" is not available for the selected provider. Choose a model from the dropdown.`;
}

export const AGENT_TIMEZONES = [
  { value: "Pacific/Honolulu",     label: "Pacific/Honolulu (UTC-10:00)" },
  { value: "America/Los_Angeles",  label: "America/Los_Angeles (UTC-08:00)" },
  { value: "America/Denver",       label: "America/Denver (UTC-07:00)" },
  { value: "America/Chicago",      label: "America/Chicago (UTC-06:00)" },
  { value: "America/New_York",     label: "America/New_York (UTC-05:00)" },
  { value: "America/Sao_Paulo",    label: "America/Sao_Paulo (UTC-03:00)" },
  { value: "UTC",                  label: "UTC (UTC+00:00)" },
  { value: "Europe/London",        label: "Europe/London (UTC+00:00)" },
  { value: "Europe/Paris",         label: "Europe/Paris (UTC+01:00)" },
  { value: "Europe/Berlin",        label: "Europe/Berlin (UTC+01:00)" },
  { value: "Africa/Cairo",         label: "Africa/Cairo (UTC+02:00)" },
  { value: "Europe/Moscow",        label: "Europe/Moscow (UTC+03:00)" },
  { value: "Europe/Istanbul",      label: "Europe/Istanbul (UTC+03:00)" },
  { value: "Asia/Dubai",           label: "Asia/Dubai (UTC+04:00)" },
  { value: "Asia/Karachi",         label: "Asia/Karachi (UTC+05:00)" },
  { value: "Asia/Kolkata",         label: "Asia/Kolkata (UTC+05:30)" },
  { value: "Asia/Colombo",         label: "Asia/Colombo (UTC+05:30)" },
  { value: "Asia/Dhaka",           label: "Asia/Dhaka (UTC+06:00)" },
  { value: "Asia/Bangkok",         label: "Asia/Bangkok (UTC+07:00)" },
  { value: "Asia/Singapore",       label: "Asia/Singapore (UTC+08:00)" },
  { value: "Asia/Shanghai",        label: "Asia/Shanghai (UTC+08:00)" },
  { value: "Asia/Tokyo",           label: "Asia/Tokyo (UTC+09:00)" },
  { value: "Asia/Seoul",           label: "Asia/Seoul (UTC+09:00)" },
  { value: "Australia/Sydney",     label: "Australia/Sydney (UTC+11:00)" },
];

export const LANGUAGES = [
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "en-IN", label: "English (India)" },
  { value: "es",    label: "Spanish" },
  { value: "es-MX", label: "Spanish (Mexico)" },
  { value: "fr",    label: "French" },
  { value: "de",    label: "German" },
  { value: "it",    label: "Italian" },
  { value: "pt-BR", label: "Portuguese (Brazil)" },
  { value: "hi",    label: "Hindi" },
  { value: "ta-IN", label: "Tamil" },
  { value: "te-IN", label: "Telugu" },
  { value: "kn-IN", label: "Kannada" },
  { value: "ml-IN", label: "Malayalam" },
  { value: "bn-IN", label: "Bengali (India)" },
  { value: "ja",    label: "Japanese" },
  { value: "ko",    label: "Korean" },
  { value: "zh",    label: "Chinese (Mandarin)" },
  { value: "ar",    label: "Arabic" },
];

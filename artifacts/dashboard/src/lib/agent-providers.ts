export const ASR_PROVIDERS = [
  { value: "sarvam", label: "Sarvam AI (Real-time Streaming)" },
  { value: "moonshine", label: "Moonshine (CPU, on your Railway voice service)" },
];

export const LLM_PROVIDERS = [
  { value: "sarvam",   label: "Sarvam AI (India-hosted)" },
  { value: "google",   label: "Google Gemini" },
  { value: "openai",   label: "OpenAI" },
  { value: "groq",     label: "Groq" },
  { value: "krutrim",  label: "Krutrim Cloud (India-hosted)" },
  { value: "qwen_cpu", label: "Qwen 0.8B (CPU, on your Railway voice service)" },
];

export const TTS_PROVIDERS = [
  { value: "sarvam",   label: "Sarvam (Bulbul) — recommended" },
  { value: "cartesia", label: "Cartesia (Sonic)" },
  { value: "pocket", label: "Pocket TTS (CPU, Indian English clip)" },
];

export const TELEPHONY_PROVIDERS = [
  { value: "twilio", label: "Twilio" },
  { value: "plivo",  label: "Plivo" },
  { value: "vonage", label: "Vonage" },
  { value: "vobiz",  label: "Vobiz" },
];

/** Full catalog for validation / existing agents. The builder picker is `asrModelsForPicker`. */
export const ASR_MODELS: Record<string, { value: string; label: string }[]> = {
  moonshine: [
    { value: "tiny", label: "Moonshine v2 Tiny (speed)" },
    { value: "small", label: "Moonshine v2 Small (check names and numbers)" },
  ],
  sarvam: [
    { value: "saaras:v3",          label: "Saaras v3" },
    { value: "saaras:v3-realtime", label: "Saaras v3 (legacy id)" },
    { value: "saarika:v2.5",       label: "Saarika v2.5 (legacy)" },
    { value: "saaras:v4",          label: "Saaras v4 (not for live calls)" },
  ],
};

export const SARVAM_PRODUCT_ASR_MODEL = "saaras:v3";

/** Product picker: only Saaras v3. A non-product saved model stays visible so the agent can be migrated. */
export function asrModelsForPicker(
  provider: string,
  current?: string | null,
): { value: string; label: string }[] {
  const product = provider === "sarvam"
    ? [{ value: SARVAM_PRODUCT_ASR_MODEL, label: "Saaras v3" }]
    : (ASR_MODELS[provider] ?? []);
  const cur = (current ?? "").trim();
  if (cur && !product.some((m) => m.value === cur)) {
    const known = (ASR_MODELS[provider] ?? []).find((m) => m.value === cur);
    return [...product, known ?? { value: cur, label: cur }];
  }
  return product;
}

/** LLM model id that routes calls through Gemini Live native audio. */
export const GEMINI_LIVE_LLM_MODEL = "gemini-3.1-flash-live-preview" as const;

export const LLM_MODELS: Record<string, { value: string; label: string }[]> = {
  openai: [
    { value: "gpt-5.1-mini", label: "GPT-5.1 Mini (Fastest — ~140ms Voice Latency)" },
    { value: "gpt-5.1",      label: "GPT-5.1 (Flagship — Advanced Reasoning & Tools)" },
    { value: "gpt-4.1-mini", label: "GPT-4.1 Mini (Low Cost — Fast Voice)" },
    { value: "gpt-4o-mini",  label: "GPT-4o Mini" },
  ],
  google: [
    { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash (recommended)" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (retired — not in picker)" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite (fastest)" },
    { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)" },
    { value: GEMINI_LIVE_LLM_MODEL, label: "Gemini 3.1 Flash Live (Native Realtime Bidirectional Voice)" },
  ],
  qwen:      [{ value: "qwen/qwen3-32b", label: "Qwen 3 32B (recommended)" }, { value: "qwen/qwen3-235b-a22b", label: "Qwen 3 235B" }],
  groq:      [{ value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (recommended)" }, { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B (fast)" }],
  sarvam: [
    { value: "sarvam-105b-conversations", label: "Sarvam 105B Conversations (recommended — voice)" },
    { value: "gemma4", label: "Gemma 4 31B" },
    { value: "sarvam-105b", label: "Sarvam 105B (reasoning / agentic)" },
    { value: "glm5.2", label: "GLM-5.2 (512K context)" },
  ],
  together: [
    { value: "Qwen/Qwen3.6-35B-A3B",   label: "Qwen3.6 35B-A3B — fast, low cost (recommended)" },
    { value: "Qwen/Qwen3.5-397B-A17B", label: "Qwen3.5 397B-A17B — best quality, agentic use" },
    { value: "MiniMaxAI/MiniMax-M3",   label: "MiniMax M3 — multilingual, strong Tamil/Indic" },
  ],
  openrouter: [
    { value: "qwen/qwen3.6-35b-a3b",   label: "Qwen3.6 35B-A3B — ~203ms, low cost (recommended, fastest)" },
    { value: "qwen/qwen3.5-397b-a17b", label: "Qwen3.5 397B-A17B — ~535ms, best for agentic use" },
  ],
  // Only models with native tool/function calling on Krutrim (see KrutrimLLM TOOL_CAPABLE_MODELS).
  krutrim: [
    { value: "gpt-oss-20b",  label: "GPT-OSS 20B — fast, tool-capable (recommended)" },
    { value: "gpt-oss-120b", label: "GPT-OSS 120B — highest quality, tool-capable" },
  ],
  qwen_cpu: [
    { value: "qwen3.5-0.8b", label: "Qwen 3.5 0.8B — recruiter, thinking off" },
  ],
};

/** Google ids Google still serves for voice. 2.5 Flash 404s — not in the picker. */
const GOOGLE_LLM_PICKER_IDS = new Set([
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-pro-preview",
  "gemini-2.5-pro",
  GEMINI_LIVE_LLM_MODEL,
]);

function withCurrentModel(
  product: { value: string; label: string }[],
  catalog: { value: string; label: string }[] | undefined,
  current?: string | null,
): { value: string; label: string }[] {
  const cur = (current ?? "").trim();
  if (!cur || product.some((m) => m.value === cur)) return product;
  const known = catalog?.find((m) => m.value === cur);
  return [...product, known ?? { value: cur, label: `${cur} (retired — pick a working model)` }];
}

/** Dropdown: only models that work on live calls. A retired saved id stays visible so the user can switch. */
export function llmModelsForPicker(
  provider: string,
  current?: string | null,
): { value: string; label: string }[] {
  const catalog = LLM_MODELS[provider] ?? [];
  if (provider === "google") {
    return withCurrentModel(
      catalog.filter((m) => GOOGLE_LLM_PICKER_IDS.has(m.value)),
      catalog,
      current,
    );
  }
  return catalog;
}

export const TTS_MODELS: Record<string, { value: string; label: string }[]> = {
  cartesia: [
    { value: "sonic-3.6",     label: "Sonic 3.6 — current (Hinglish, 44 languages)" },
    { value: "sonic-3.5",     label: "Sonic 3.5 — previous snapshot" },
    { value: "sonic-preview", label: "Sonic preview (beta snapshot)" },
    { value: "sonic-3",     label: "Sonic 3" },
    { value: "sonic-2",     label: "Sonic 2 (stable)" },
    { value: "sonic-turbo", label: "Sonic Turbo (fast, low-latency)" },
  ],
  pocket: [
    { value: "pocket", label: "Pocket TTS — voice comes from POCKET_VOICE_WAV" },
  ],
  sarvam: [
    { value: "bulbul:v3",      label: "Bulbul v3 — 38 voices, Indian languages (recommended)" },
    { value: "bulbul:v3-beta", label: "Bulbul v3 Beta" },
    { value: "bulbul:v2",      label: "Bulbul v2 — 7 voices" },
  ],
};

/** Bulbul v3 / v3-beta speakers (skill: anushka/etc. are v2-only). */
export const SARVAM_TTS_VOICES_V3: { value: string; label: string }[] = [
  { value: "ritu",     label: "Ritu (female)" },
  { value: "priya",    label: "Priya (female)" },
  { value: "neha",     label: "Neha (female)" },
  { value: "pooja",    label: "Pooja (female)" },
  { value: "simran",   label: "Simran (female)" },
  { value: "kavya",    label: "Kavya (female)" },
  { value: "ishita",   label: "Ishita (female)" },
  { value: "shreya",   label: "Shreya (female)" },
  { value: "roopa",    label: "Roopa (female)" },
  { value: "tanya",    label: "Tanya (female)" },
  { value: "shruti",   label: "Shruti (female)" },
  { value: "suhani",   label: "Suhani (female)" },
  { value: "kavitha",  label: "Kavitha (female)" },
  { value: "rupali",   label: "Rupali (female)" },
  { value: "rahul",    label: "Rahul (male)" },
  { value: "rohan",    label: "Rohan (male)" },
  { value: "aditya",   label: "Aditya (male)" },
  { value: "amit",     label: "Amit (male)" },
  { value: "dev",      label: "Dev (male)" },
  { value: "ratan",    label: "Ratan (male)" },
  { value: "varun",    label: "Varun (male)" },
  { value: "manan",    label: "Manan (male)" },
  { value: "sumit",    label: "Sumit (male)" },
  { value: "kabir",    label: "Kabir (male)" },
  { value: "aayan",    label: "Aayan (male)" },
  { value: "shubh",    label: "Shubh (male)" },
  { value: "ashutosh", label: "Ashutosh (male)" },
  { value: "advait",   label: "Advait (male)" },
  { value: "anand",    label: "Anand (male)" },
  { value: "tarun",    label: "Tarun (male)" },
  { value: "sunny",    label: "Sunny (male)" },
  { value: "mani",     label: "Mani (male)" },
  { value: "gokul",    label: "Gokul (male)" },
  { value: "vijay",    label: "Vijay (male)" },
  { value: "mohit",    label: "Mohit (male)" },
  { value: "rehan",    label: "Rehan (male)" },
  { value: "soham",    label: "Soham (male)" },
];

/** Bulbul v2 speakers — incompatible with bulbul:v3 (API 400). */
export const SARVAM_TTS_VOICES_V2: { value: string; label: string }[] = [
  { value: "anushka",  label: "Anushka (female) — v2" },
  { value: "manisha",  label: "Manisha (female) — v2" },
  { value: "vidya",    label: "Vidya (female) — v2" },
  { value: "arya",     label: "Arya (female) — v2" },
  { value: "abhilash", label: "Abhilash (male) — v2" },
  { value: "karun",    label: "Karun (male) — v2" },
  { value: "hitesh",   label: "Hitesh (male) — v2" },
];

/** Voices allowed for a Sarvam TTS model. Empty/unknown model → v3. */
export function getSarvamTtsVoices(ttsModel?: string | null): { value: string; label: string }[] {
  const model = (ttsModel ?? "bulbul:v3").toLowerCase();
  if (model === "bulbul:v2") return SARVAM_TTS_VOICES_V2;
  return SARVAM_TTS_VOICES_V3;
}

export function isSarvamVoiceCompatible(voice: string | null | undefined, ttsModel?: string | null): boolean {
  if (!voice || voice === "__custom__") return true;
  const model = (ttsModel ?? "bulbul:v3").toLowerCase();
  const isV2Speaker = SARVAM_TTS_VOICES_V2.some((v) => v.value === voice);
  if (model === "bulbul:v2") {
    // v2 catalog or custom clone ids (not a known v3-only name).
    return isV2Speaker || !SARVAM_TTS_VOICES_V3.some((v) => v.value === voice);
  }
  // v3: reject known v2-only speakers; allow catalog v3 + Creative Studio clone ids.
  if (isV2Speaker) return false;
  return true;
}

/** Default Cartesia voice for new SnapServe agents (listed as Gayathri). */
export const DEFAULT_CARTESIA_VOICE_ID = "a8adc74b-c9c1-45e0-aae7-9a60ba64bbee";
export const DEFAULT_CARTESIA_VOICE_NAME = "Gayathri";

export const TTS_VOICES: Record<string, { value: string; label: string }[] | null> = {
  pocket: [
    { value: "indian-english", label: "Indian English clip on the voice service" },
  ],
  cartesia: [
    { value: DEFAULT_CARTESIA_VOICE_ID, label: DEFAULT_CARTESIA_VOICE_NAME },
    { value: "a0e99841-438c-4a64-b679-ae501e7d6091", label: "Barbershop Man" },
    { value: "79a125e8-cd45-4c13-8a67-188112f4dd22", label: "British Narration Lady" },
    { value: "b7d50908-b17c-442d-ad8d-810c63997ed9", label: "Calm Lady" },
    { value: "5c42302c-194b-4d0c-ba1a-8cb485c84ab9", label: "Reading Man" },
    { value: "c45bc5ec-dc68-4feb-8829-6ac1e9f4f478", label: "Customer Support Lady" },
    { value: "f9836c38-f195-45be-b41c-91b82a5d59c8", label: "Southern Man" },
    { value: "e00d0e4c-a5c8-443c-8230-60ea3f5b45ff", label: "Friendly Australian Man" },
    { value: "__custom__", label: "Paste custom Voice ID" },
  ],
  elevenlabs: [
    { value: "21m00Tcm4TlvDq8ikWAM", label: "Rachel (Female)" },
    { value: "AZnzlk1XvdvUeBnXmlld", label: "Domi (Female)" },
    { value: "EXAVITQu4vr4xnSDxMaL", label: "Bella (Female)" },
    { value: "MF3mGyEYCl7XYWbV9V6O", label: "Elli (Female)" },
    { value: "ErXwobaYiN019PkySvjV", label: "Antoni (Male)" },
    { value: "TxGEqnHWrfWFTfGW9XjX", label: "Josh (Male)" },
    { value: "VR6AewLTigWG4xSOukaG", label: "Arnold (Male)" },
    { value: "pNInz6obpgDQGcFmaJgB", label: "Adam (Male)" },
    { value: "yoZ06aMxZJJ28mfd3POQ", label: "Sam (Male)" },
    { value: "__custom__", label: "Paste custom Voice ID" },
  ],
  // Default catalogue = v3. Use getSarvamTtsVoices(ttsModel) when filtering by model.
  sarvam: SARVAM_TTS_VOICES_V3,
};

/**
 * Returns an inline error message if `model` is not in the known list for
 * `provider`, or `null` when the combination is valid.
 *
 * Returns `null` for two safe cases:
 *   - The provider has no predefined model list (e.g. ElevenLabs, Deepgram for TTS).
 *   - The model field is empty / undefined (UI falls back to runtime defaults).
 */
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
  { value: "Pacific/Honolulu",    label: "Pacific/Honolulu (UTC-10:00)" },
  { value: "America/Anchorage",   label: "America/Anchorage (UTC-09:00)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (UTC-08:00)" },
  { value: "America/Denver",      label: "America/Denver (UTC-07:00)" },
  { value: "America/Chicago",     label: "America/Chicago (UTC-06:00)" },
  { value: "America/Mexico_City", label: "America/Mexico_City (UTC-06:00)" },
  { value: "America/New_York",    label: "America/New_York (UTC-05:00)" },
  { value: "America/Toronto",     label: "America/Toronto (UTC-05:00)" },
  { value: "America/Sao_Paulo",   label: "America/Sao_Paulo (UTC-03:00)" },
  { value: "America/Buenos_Aires", label: "America/Buenos_Aires (UTC-03:00)" },
  { value: "UTC",                 label: "UTC (UTC+00:00)" },
  { value: "Europe/London",       label: "Europe/London (UTC+00:00)" },
  { value: "Europe/Paris",        label: "Europe/Paris (UTC+01:00)" },
  { value: "Europe/Berlin",       label: "Europe/Berlin (UTC+01:00)" },
  { value: "Europe/Amsterdam",    label: "Europe/Amsterdam (UTC+01:00)" },
  { value: "Africa/Cairo",        label: "Africa/Cairo (UTC+02:00)" },
  { value: "Africa/Johannesburg", label: "Africa/Johannesburg (UTC+02:00)" },
  { value: "Europe/Moscow",       label: "Europe/Moscow (UTC+03:00)" },
  { value: "Europe/Istanbul",     label: "Europe/Istanbul (UTC+03:00)" },
  { value: "Asia/Dubai",          label: "Asia/Dubai (UTC+04:00)" },
  { value: "Asia/Karachi",        label: "Asia/Karachi (UTC+05:00)" },
  { value: "Asia/Kolkata",        label: "Asia/Kolkata (UTC+05:30)" },
  { value: "Asia/Colombo",        label: "Asia/Colombo (UTC+05:30)" },
  { value: "Asia/Dhaka",          label: "Asia/Dhaka (UTC+06:00)" },
  { value: "Asia/Bangkok",        label: "Asia/Bangkok (UTC+07:00)" },
  { value: "Asia/Singapore",      label: "Asia/Singapore (UTC+08:00)" },
  { value: "Asia/Shanghai",       label: "Asia/Shanghai (UTC+08:00)" },
  { value: "Asia/Tokyo",          label: "Asia/Tokyo (UTC+09:00)" },
  { value: "Asia/Seoul",          label: "Asia/Seoul (UTC+09:00)" },
  { value: "Australia/Perth",     label: "Australia/Perth (UTC+08:00)" },
  { value: "Australia/Sydney",    label: "Australia/Sydney (UTC+11:00)" },
  { value: "Pacific/Auckland",    label: "Pacific/Auckland (UTC+13:00)" },
];

export const LANGUAGES = [
  /* ── English variants ── */
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "en-IN", label: "English (India)" },
  { value: "en-AU", label: "English (Australia)" },
  { value: "en-CA", label: "English (Canada)" },
  { value: "en-NZ", label: "English (New Zealand)" },
  { value: "en-ZA", label: "English (South Africa)" },
  { value: "en-SG", label: "English (Singapore)" },
  { value: "en-HK", label: "English (Hong Kong)" },
  { value: "en-PH", label: "English (Philippines)" },
  { value: "en-KE", label: "English (Kenya)" },
  { value: "en-NG", label: "English (Nigeria)" },
  { value: "en-GH", label: "English (Ghana)" },
  { value: "en-TZ", label: "English (Tanzania)" },
  { value: "en-IE", label: "English (Ireland)" },

  /* ── 22 Scheduled Indian Languages ── */
  { value: "as-IN",  label: "Assamese (India)" },
  { value: "bn-IN",  label: "Bengali (India)" },
  { value: "brx-IN", label: "Bodo (India)" },
  { value: "doi-IN", label: "Dogri (India)" },
  { value: "gu-IN",  label: "Gujarati (India)" },
  { value: "hi-IN",  label: "Hindi (India)" },
  { value: "kn-IN",  label: "Kannada (India)" },
  { value: "ks-IN",  label: "Kashmiri (India)" },
  { value: "kok-IN", label: "Konkani (India)" },
  { value: "mai-IN", label: "Maithili (India)" },
  { value: "ml-IN",  label: "Malayalam (India)" },
  { value: "mni-IN", label: "Meitei / Manipuri (India)" },
  { value: "mr-IN",  label: "Marathi (India)" },
  { value: "ne-IN",  label: "Nepali (India)" },
  { value: "or-IN",  label: "Odia (India)" },
  { value: "pa-IN",  label: "Punjabi (India)" },
  { value: "sa-IN",  label: "Sanskrit (India)" },
  { value: "sat-IN", label: "Santali (India)" },
  { value: "sd-IN",  label: "Sindhi (India)" },
  { value: "ta-IN",  label: "Tamil (India)" },
  { value: "te-IN",  label: "Telugu (India)" },
  { value: "ur-IN",  label: "Urdu (India)" },

  /* ── Other Indian regional languages ── */
  { value: "bho-IN", label: "Bhojpuri (India)" },
  { value: "hne-IN", label: "Chhattisgarhi (India)" },
  { value: "gbm-IN", label: "Garhwali (India)" },
  { value: "hoj-IN", label: "Hadothi / Rajasthani (India)" },
  { value: "bgc-IN", label: "Haryanvi (India)" },
  { value: "tcy-IN", label: "Tulu (India)" },
  { value: "mwr-IN", label: "Marwari (India)" },
  { value: "lus-IN", label: "Mizo (India)" },
  { value: "kha-IN", label: "Khasi (India)" },
  { value: "gom-IN", label: "Goan Konkani (India)" },
  { value: "kfy-IN", label: "Kumaoni (India)" },

  /* ── Tamil regional variants ── */
  { value: "ta-SG",  label: "Tamil (Singapore)" },
  { value: "ta-MY",  label: "Tamil (Malaysia)" },
  { value: "ta-LK",  label: "Tamil (Sri Lanka)" },

  /* ── Punjabi / Bengali regional ── */
  { value: "pa-PK",  label: "Punjabi (Pakistan)" },
  { value: "bn-BD",  label: "Bengali (Bangladesh)" },

  /* ── South Asian neighbours ── */
  { value: "ne-NP",  label: "Nepali (Nepal)" },
  { value: "si-LK",  label: "Sinhala (Sri Lanka)" },
  { value: "dv-MV",  label: "Dhivehi (Maldives)" },
  { value: "ur-PK",  label: "Urdu (Pakistan)" },
  { value: "ps-AF",  label: "Pashto (Afghanistan)" },
  { value: "prs-AF", label: "Dari (Afghanistan)" },

  /* ── South-East Asian ── */
  { value: "id-ID",  label: "Indonesian" },
  { value: "ms-MY",  label: "Malay (Malaysia)" },
  { value: "ms-SG",  label: "Malay (Singapore)" },
  { value: "th-TH",  label: "Thai" },
  { value: "vi-VN",  label: "Vietnamese" },
  { value: "fil-PH", label: "Filipino / Tagalog" },
  { value: "km-KH",  label: "Khmer (Cambodia)" },
  { value: "my-MM",  label: "Burmese (Myanmar)" },
  { value: "lo-LA",  label: "Lao" },
  { value: "jv-ID",  label: "Javanese (Indonesia)" },
  { value: "su-ID",  label: "Sundanese (Indonesia)" },

  /* ── East Asian ── */
  { value: "zh-CN",  label: "Chinese (Mandarin, Simplified)" },
  { value: "zh-TW",  label: "Chinese (Mandarin, Traditional)" },
  { value: "zh-HK",  label: "Chinese (Cantonese, Hong Kong)" },
  { value: "yue-CN", label: "Chinese (Cantonese, Mainland)" },
  { value: "wuu-CN", label: "Chinese (Wu / Shanghainese)" },
  { value: "ja-JP",  label: "Japanese" },
  { value: "ko-KR",  label: "Korean" },
  { value: "mn-MN",  label: "Mongolian" },

  /* ── Central / South-West Asian ── */
  { value: "kk-KZ",  label: "Kazakh" },
  { value: "uz-UZ",  label: "Uzbek" },
  { value: "ky-KG",  label: "Kyrgyz" },
  { value: "tk-TM",  label: "Turkmen" },
  { value: "tg-TJ",  label: "Tajik" },
  { value: "az-AZ",  label: "Azerbaijani" },
  { value: "ka-GE",  label: "Georgian" },
  { value: "hy-AM",  label: "Armenian" },
  { value: "fa-IR",  label: "Persian / Farsi" },

  /* ── European ── */
  { value: "es-ES",  label: "Spanish (Spain)" },
  { value: "es-MX",  label: "Spanish (Mexico)" },
  { value: "es-AR",  label: "Spanish (Argentina)" },
  { value: "es-CO",  label: "Spanish (Colombia)" },
  { value: "es-CL",  label: "Spanish (Chile)" },
  { value: "es-PE",  label: "Spanish (Peru)" },
  { value: "es-VE",  label: "Spanish (Venezuela)" },
  { value: "es-US",  label: "Spanish (US)" },
  { value: "fr-FR",  label: "French (France)" },
  { value: "fr-CA",  label: "French (Canada)" },
  { value: "fr-BE",  label: "French (Belgium)" },
  { value: "fr-CH",  label: "French (Switzerland)" },
  { value: "de-DE",  label: "German (Germany)" },
  { value: "de-AT",  label: "German (Austria)" },
  { value: "de-CH",  label: "German (Switzerland)" },
  { value: "it-IT",  label: "Italian (Italy)" },
  { value: "it-CH",  label: "Italian (Switzerland)" },
  { value: "pt-BR",  label: "Portuguese (Brazil)" },
  { value: "pt-PT",  label: "Portuguese (Portugal)" },
  { value: "ru-RU",  label: "Russian" },
  { value: "pl-PL",  label: "Polish" },
  { value: "nl-NL",  label: "Dutch (Netherlands)" },
  { value: "nl-BE",  label: "Dutch (Belgium)" },
  { value: "sv-SE",  label: "Swedish" },
  { value: "nb-NO",  label: "Norwegian (Bokmål)" },
  { value: "nn-NO",  label: "Norwegian (Nynorsk)" },
  { value: "da-DK",  label: "Danish" },
  { value: "fi-FI",  label: "Finnish" },
  { value: "cs-CZ",  label: "Czech" },
  { value: "sk-SK",  label: "Slovak" },
  { value: "ro-RO",  label: "Romanian" },
  { value: "hu-HU",  label: "Hungarian" },
  { value: "el-GR",  label: "Greek" },
  { value: "bg-BG",  label: "Bulgarian" },
  { value: "hr-HR",  label: "Croatian" },
  { value: "sr-RS",  label: "Serbian (Latin)" },
  { value: "bs-BA",  label: "Bosnian" },
  { value: "sl-SI",  label: "Slovenian" },
  { value: "mk-MK",  label: "Macedonian" },
  { value: "sq-AL",  label: "Albanian" },
  { value: "uk-UA",  label: "Ukrainian" },
  { value: "be-BY",  label: "Belarusian" },
  { value: "lt-LT",  label: "Lithuanian" },
  { value: "lv-LV",  label: "Latvian" },
  { value: "et-EE",  label: "Estonian" },
  { value: "tr-TR",  label: "Turkish" },
  { value: "ca-ES",  label: "Catalan" },
  { value: "gl-ES",  label: "Galician" },
  { value: "eu-ES",  label: "Basque" },
  { value: "cy-GB",  label: "Welsh" },
  { value: "ga-IE",  label: "Irish Gaelic" },
  { value: "is-IS",  label: "Icelandic" },
  { value: "mt-MT",  label: "Maltese" },

  /* ── Middle-East ── */
  { value: "ar-SA",  label: "Arabic (Saudi Arabia)" },
  { value: "ar-EG",  label: "Arabic (Egypt)" },
  { value: "ar-AE",  label: "Arabic (UAE)" },
  { value: "ar-KW",  label: "Arabic (Kuwait)" },
  { value: "ar-QA",  label: "Arabic (Qatar)" },
  { value: "ar-BH",  label: "Arabic (Bahrain)" },
  { value: "ar-IQ",  label: "Arabic (Iraq)" },
  { value: "ar-JO",  label: "Arabic (Jordan)" },
  { value: "ar-LB",  label: "Arabic (Lebanon)" },
  { value: "ar-LY",  label: "Arabic (Libya)" },
  { value: "ar-MA",  label: "Arabic (Morocco)" },
  { value: "ar-DZ",  label: "Arabic (Algeria)" },
  { value: "ar-TN",  label: "Arabic (Tunisia)" },
  { value: "ar-OM",  label: "Arabic (Oman)" },
  { value: "ar-SY",  label: "Arabic (Syria)" },
  { value: "ar-YE",  label: "Arabic (Yemen)" },
  { value: "he-IL",  label: "Hebrew" },
  { value: "ku-IQ",  label: "Kurdish (Sorani)" },

  /* ── Africa ── */
  { value: "sw-KE",  label: "Swahili (Kenya)" },
  { value: "sw-TZ",  label: "Swahili (Tanzania)" },
  { value: "af-ZA",  label: "Afrikaans (South Africa)" },
  { value: "am-ET",  label: "Amharic (Ethiopia)" },
  { value: "om-ET",  label: "Oromo (Ethiopia)" },
  { value: "ti-ET",  label: "Tigrinya (Ethiopia)" },
  { value: "so-SO",  label: "Somali" },
  { value: "ha-NG",  label: "Hausa (Nigeria)" },
  { value: "ig-NG",  label: "Igbo (Nigeria)" },
  { value: "yo-NG",  label: "Yoruba (Nigeria)" },
  { value: "zu-ZA",  label: "Zulu (South Africa)" },
  { value: "xh-ZA",  label: "Xhosa (South Africa)" },
  { value: "st-ZA",  label: "Sesotho (South Africa)" },
  { value: "tn-ZA",  label: "Setswana (South Africa)" },
  { value: "nso-ZA", label: "Sepedi / Sesotho sa Leboa (South Africa)" },
  { value: "ln-CD",  label: "Lingala (DR Congo)" },

  /* ── Americas ── */
  { value: "qu-PE",  label: "Quechua (Peru)" },
  { value: "gn-PY",  label: "Guaraní (Paraguay)" },
  { value: "ht-HT",  label: "Haitian Creole" },
];

/**
 * Sarvam saaras:v3-realtime `language_code` values except `auto`.
 * `auto` is the Transcriber “Switch language during call” toggle, not a picker row.
 * Odia is `or-IN` (legacy socket used `od-IN`).
 */
export const SARVAM_REALTIME_LANGUAGE_CODES = [
  "en-IN", "hi-IN", "bn-IN", "kn-IN", "ml-IN", "mr-IN", "or-IN", "pa-IN",
  "ta-IN", "te-IN", "gu-IN", "as-IN", "ur-IN", "ne-IN", "kok-IN", "ks-IN",
  "sd-IN", "sa-IN", "sat-IN", "mni-IN", "brx-IN", "mai-IN", "doi-IN",
] as const;

const SARVAM_REALTIME_LANGUAGE_SET = new Set<string>(SARVAM_REALTIME_LANGUAGE_CODES);

/** Languages shown in the builder picker and “Languages allowed” chips for Sarvam STT. */
export const SARVAM_STT_LANGUAGES = LANGUAGES.filter((l) => SARVAM_REALTIME_LANGUAGE_SET.has(l.value));

/** @deprecated alias — same 23-code table as SARVAM_STT_LANGUAGES. */
export const SARVAM_PERSONALISATION_LANGUAGES = SARVAM_STT_LANGUAGES;

/**
 * True when this ASR model rides the realtime socket (partials + ms VAD).
 * Saarika stays on the legacy finals-only socket.
 */
export function isSarvamRealtimeAsr(model: string | null | undefined): boolean {
  const m = (model ?? "").trim();
  if (m.startsWith("saarika")) return false;
  return m === "" || m === "saaras:v3" || m === "saaras:v3-realtime" || m === "saaras:v4" || m.startsWith("saaras");
}

/** Normalize a BCP-47-ish language tag to its lowercase base language ("ta-IN" → "ta"). */
export function baseLanguage(language: string | null | undefined): string {
  return (language ?? "en-US").split("-")[0]!.toLowerCase();
}

/**
 * Single source of truth for whether a curated (admin-whitelisted) voice is
 * compatible with an agent language:
 *   - English agent language → EVERY whitelisted voice is compatible.
 *   - Non-English → only voices whose base language matches (e.g. "ta-IN" → "ta").
 */
export function isVoiceCompatibleWithLanguage(
  voiceLanguage: string | null | undefined,
  agentLanguage: string | null | undefined,
): boolean {
  const agentBase = baseLanguage(agentLanguage);
  if (agentBase === "en") return true;
  return (voiceLanguage ?? "").split("-")[0]!.toLowerCase() === agentBase;
}

/**
 * Voices offered in the agent picker for a given language.
 * Always returns EVERY curated voice; language matches are sorted first so
 * Hindi (etc.) recommendations appear at the top without hiding the rest.
 * English agents already treat every voice as compatible, so order is unchanged.
 *
 * @deprecated Prefer {@link orderVoicesByLanguage} by name — same behavior.
 */
export function filterVoicesForLanguage<T extends { language?: string | null }>(
  voices: readonly T[],
  agentLanguage: string | null | undefined,
): T[] {
  return orderVoicesByLanguage(voices, agentLanguage);
}

/**
 * Should a saved curated voice be cleared because the agent language changed?
 *
 * The picker always offers every curated voice (language matches sorted first),
 * so a language change never removes a whitelisted voice from the list.
 * Voices absent from the whitelist are user-pasted IDs and are never cleared.
 */
export function shouldClearVoiceForLanguage<T extends { id: string; language?: string | null }>(
  voices: readonly T[],
  ttsVoice: string | null | undefined,
  agentLanguage: string | null | undefined,
): boolean {
  if (!ttsVoice || ttsVoice === "__custom__") return false;
  if (voices.length === 0) return false;
  if (!voices.some(v => v.id === ttsVoice)) return false;
  // Full catalog is always offered — keep any curated selection.
  void agentLanguage;
  return false;
}

/**
 * Order voices so the agent language's own voices come first, without hiding
 * the rest. Used by the voice picker so recommended voices surface at the top.
 */
export function orderVoicesByLanguage<T extends { language?: string | null }>(
  voices: readonly T[],
  agentLanguage: string | null | undefined,
): T[] {
  const matching: T[] = [];
  const rest: T[] = [];
  for (const v of voices) {
    (isVoiceCompatibleWithLanguage(v.language, agentLanguage) ? matching : rest).push(v);
  }
  return [...matching, ...rest];
}

/** True for any Tamil language variant (base language `ta`, e.g. ta-IN, ta-SG). */
export function isTamilLanguage(language: string | undefined | null): boolean {
  if (!language) return false;
  return language.toLowerCase().split("-")[0] === "ta";
}

/** @deprecated Classic Gemini text models removed — use defaultSarvamModel(). */
export function defaultGeminiModel(): string {
  return defaultSarvamModel();
}

/** Default Sarvam LLM — conversational 105B for voice (/v1). */
export function defaultSarvamModel(): string {
  return LLM_MODELS.sarvam?.[0]?.value ?? "sarvam-105b-conversations";
}

/** Canonical LLM defaults for the VoiceOrch auto-selection rule.
 *  All languages → Sarvam 105B Conversations on the classic STT→LLM→TTS stack.
 *  Live remains an explicit voice-stack pick only. */
export const DEFAULT_TAMIL_LLM_PROVIDER = "sarvam" as const;
export const DEFAULT_TAMIL_LLM_MODEL    = "sarvam-105b-conversations" as const;
export const DEFAULT_NONTAMIL_LLM_PROVIDER = "sarvam" as const;
export const DEFAULT_NONTAMIL_LLM_MODEL    = "sarvam-105b-conversations" as const;

/**
 * Returns the canonical llmProvider + llmModel for the given language selection.
 * All languages → Sarvam 105B Conversations on the classic voice stack.
 * Never returns the Gemini Live model — Live must be chosen explicitly.
 */
export function defaultLlmForLanguages(
  _languages: string | string[] | undefined | null,
): { llmProvider: string; llmModel: string } {
  return { llmProvider: DEFAULT_NONTAMIL_LLM_PROVIDER, llmModel: DEFAULT_NONTAMIL_LLM_MODEL };
}

export function isGeminiLiveLlmModel(model: string | undefined | null): boolean {
  return model === GEMINI_LIVE_LLM_MODEL;
}

/** True when the agent uses Gemini Live (model selection or saved voice stack). */
export function isGeminiLiveAgent(opts: {
  llmModel?: string | null;
  voiceStack?: string | null;
}): boolean {
  return isGeminiLiveLlmModel(opts.llmModel) || opts.voiceStack === "gemini_live";
}

export function geminiLiveModelLabel(): string {
  return LLM_MODELS.google?.find((m) => m.value === GEMINI_LIVE_LLM_MODEL)?.label
    ?? "Gemini 3.1 Flash Live";
}

/** Sync voiceStack when the user picks a model in the Model dialog. */
export function voiceStackForLlmModel(model: string): "classic" | "gemini_live" {
  return isGeminiLiveLlmModel(model) ? "gemini_live" : "classic";
}

/** Voice stack: classic STT+LLM+TTS vs Gemini native audio Live. */
export const VOICE_STACK_OPTIONS = [
  { value: "classic", label: "Classic (STT + LLM + TTS)" },
  { value: "gemini_live", label: "Gemini Live 3.1" },
] as const;

/** Provider + model to persist when the user picks a voice stack in the UI. */
export function llmFieldsForVoiceStack(
  stack: "classic" | "gemini_live",
  current: { llmProvider?: string | null; llmModel?: string | null },
): { llmProvider: string; llmModel: string } {
  if (stack === "gemini_live") {
    return { llmProvider: "google", llmModel: GEMINI_LIVE_LLM_MODEL };
  }
  if (isGeminiLiveLlmModel(current.llmModel) || current.llmProvider === "google" || current.llmProvider === "gemini") {
    return { llmProvider: DEFAULT_NONTAMIL_LLM_PROVIDER, llmModel: defaultSarvamModel() };
  }
  return {
    llmProvider: current.llmProvider || DEFAULT_NONTAMIL_LLM_PROVIDER,
    llmModel: current.llmModel || defaultSarvamModel(),
  };
}

export const GEMINI_LIVE_THINKING_LEVELS = [
  { value: "minimal", label: "Minimal — lowest latency (recommended)" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const;

/**
 * Base language codes supported by Gemini Live native audio
 * (Gemini API Live capabilities guide — ~97 languages).
 * Native audio does not take speechConfig.languageCode; language is enforced
 * via system instructions using the agent's `language` / `asrLanguage` field.
 */
export const GEMINI_LIVE_BASE_LANGUAGES = new Set([
  "af", "ak", "sq", "am", "ar", "hy", "as", "az", "eu", "be", "bn", "bs", "bg",
  "my", "ca", "ceb", "zh", "hr", "cs", "da", "nl", "en", "et", "fo", "fil", "fi",
  "fr", "gl", "ka", "de", "el", "gu", "ha", "iw", "he", "hi", "hu", "is", "id",
  "ga", "it", "ja", "kn", "kk", "km", "rw", "ko", "ku", "ky", "lo", "lv", "lt",
  "mk", "ms", "ml", "mt", "mi", "mr", "mn", "ne", "no", "or", "om", "ps", "fa",
  "pl", "pt", "pa", "qu", "ro", "rm", "ru", "sr", "sd", "si", "sk", "sl", "so",
  "st", "es", "sw", "sv", "tg", "ta", "te", "th", "tn", "tr", "tk", "uk", "ur",
  "uz", "vi", "cy", "fy", "wo", "yo", "zu",
]);

/** True when a BCP-47 tag is supported by Gemini Live (base language match). */
export function isGeminiLiveLanguage(code: string | null | undefined): boolean {
  if (!code) return false;
  return GEMINI_LIVE_BASE_LANGUAGES.has(baseLanguage(code));
}

/**
 * SnapServe language options that Gemini Live can speak.
 * Prefer regional tags already in LANGUAGES (e.g. hi-IN, ta-IN, en-IN).
 */
export const GEMINI_LIVE_LANGUAGES = LANGUAGES.filter((l) => isGeminiLiveLanguage(l.value));

/** Language picker options for classic vs Gemini Live agents. */
export function languagesForAgent(isGeminiLive: boolean): typeof LANGUAGES {
  return isGeminiLive ? GEMINI_LIVE_LANGUAGES : SARVAM_STT_LANGUAGES;
}

/** Static fallback; runtime UI may fetch GET /api/gemini-live/voices. */
export const GEMINI_LIVE_VOICES = [
  { name: "Zephyr", style: "Bright" }, { name: "Puck", style: "Upbeat" }, { name: "Charon", style: "Informative" },
  { name: "Kore", style: "Firm" }, { name: "Fenrir", style: "Excitable" }, { name: "Leda", style: "Youthful" },
  { name: "Orus", style: "Firm" }, { name: "Aoede", style: "Breezy" }, { name: "Callirrhoe", style: "Easy-going" },
  { name: "Autonoe", style: "Bright" }, { name: "Enceladus", style: "Breathy" }, { name: "Iapetus", style: "Clear" },
  { name: "Umbriel", style: "Easy-going" }, { name: "Algieba", style: "Smooth" }, { name: "Despina", style: "Smooth" },
  { name: "Erinome", style: "Clear" }, { name: "Algenib", style: "Gravelly" }, { name: "Rasalgethi", style: "Informative" },
  { name: "Laomedeia", style: "Upbeat" }, { name: "Achernar", style: "Soft" }, { name: "Alnilam", style: "Firm" },
  { name: "Schedar", style: "Even" }, { name: "Gacrux", style: "Mature" }, { name: "Pulcherrima", style: "Forward" },
  { name: "Achird", style: "Friendly" }, { name: "Zubenelgenubi", style: "Casual" }, { name: "Vindemiatrix", style: "Gentle" },
  { name: "Sadachbia", style: "Lively" }, { name: "Sadaltager", style: "Knowledgeable" }, { name: "Sulafat", style: "Warm" },
] as const;

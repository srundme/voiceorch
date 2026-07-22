export const ASR_PROVIDERS = [
  { value: "deepgram",  label: "Deepgram" },
  { value: "assemblyai",label: "AssemblyAI" },
  { value: "whisper",   label: "Whisper (OpenAI)" },
  { value: "azure",     label: "Azure Speech" },
  { value: "sarvam",    label: "Sarvam (Saarika)" },
  { value: "cartesia",  label: "Cartesia" },
];

export const LLM_PROVIDERS = [
  { value: "google",    label: "Google Gemini" },
  { value: "groq",      label: "Groq" },
];

export const TTS_PROVIDERS = [
  { value: "cartesia", label: "Cartesia (Sonic)" },
];

export const TELEPHONY_PROVIDERS = [
  { value: "twilio", label: "Twilio" },
  { value: "plivo",  label: "Plivo" },
  { value: "vonage", label: "Vonage" },
  { value: "vobiz",  label: "Vobiz" },
];

export const ASR_MODELS: Record<string, { value: string; label: string }[]> = {
  azure:      [{ value: "en-US-standard", label: "Auto (base model from language)" }, { value: "en-US-enhanced", label: "Auto — enhanced (base model from language)" }, { value: "en-IN-standard", label: "Auto — Indic (base model from language)" }],
  assemblyai: [{ value: "best", label: "Best (default)" }, { value: "nano", label: "Nano (fast)" }],
  sarvam: [
    { value: "saarika:v2.5",       label: "Saarika v2.5 — real-time streaming (recommended)" },
    { value: "saaras:v3",          label: "Saaras v3 — real-time streaming" },
    { value: "saaras:v3-realtime", label: "Saaras v3 Real-time — streaming" },
    { value: "saarika:flash",      label: "Saarika Flash — batch (fast)" },
  ],
  cartesia: [{ value: "sonic-english", label: "Sonic English" }, { value: "sonic-multilingual", label: "Sonic Multilingual" }],
  deepgram:  [{ value: "nova-2-general", label: "Nova 2 General" }, { value: "nova-2-phonecall", label: "Nova 2 Phone Call" }],
  whisper:   [{ value: "whisper-1", label: "Whisper v1" }],
};

export const LLM_MODELS: Record<string, { value: string; label: string }[]> = {
  openai:    [{ value: "gpt-4o-mini", label: "GPT-4o Mini" }, { value: "gpt-4o", label: "GPT-4o" }, { value: "gpt-4-turbo", label: "GPT-4 Turbo" }, { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" }],
  anthropic: [{ value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" }, { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" }, { value: "claude-3-opus-20240229", label: "Claude 3 Opus" }],
  google:    [{ value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite (fastest — zero-latency-overhead mode)" }, { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite (newest, low-latency)" }, { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (recommended)" }, { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash (newest, most capable)" }, { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (most capable, legacy)" }, { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash (legacy)" }],
  qwen:      [{ value: "qwen/qwen3-32b", label: "Qwen 3 32B (recommended)" }, { value: "qwen/qwen3-235b-a22b", label: "Qwen 3 235B" }],
  groq:      [{ value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (recommended)" }, { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B (fast)" }, { value: "gemma2-9b-it", label: "Gemma 2 9B" }],
  sarvam:    [{ value: "sarvam-30b", label: "Sarvam 30B (recommended)" }, { value: "sarvam-105b", label: "Sarvam 105B" }],
  deepseek:  [{ value: "deepseek-chat", label: "DeepSeek Chat" }, { value: "deepseek-reasoner", label: "DeepSeek Reasoner" }],
  mistral:   [{ value: "mistral-large-latest", label: "Mistral Large" }, { value: "mistral-small-latest", label: "Mistral Small" }],
};

export const TTS_MODELS: Record<string, { value: string; label: string }[]> = {
  cartesia: [
    { value: "sonic-3.5",   label: "Sonic 3.5 — 42 languages, lowest latency" },
    { value: "sonic-3",     label: "Sonic 3" },
    { value: "sonic-2",     label: "Sonic 2 (stable)" },
    { value: "sonic-turbo", label: "Sonic Turbo (fast, low-latency)" },
  ],
};

export const TTS_VOICES: Record<string, { value: string; label: string }[] | null> = {
  cartesia: [
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

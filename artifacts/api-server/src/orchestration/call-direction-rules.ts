/**
 * Opening-language hint only. Inbound/outbound wording lives in the agent prompt.
 */

export type CallDirectionKind = "inbound" | "outbound";

/** Map memory language_pref / BCP-47 / plain names → stable lang key. */
export function resolveOpeningLanguageKey(
  raw: string | null | undefined,
): string {
  const v = (raw ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (!v) return "en";
  if (v === "en" || v.startsWith("en-") || v === "english") return "en";
  if (v === "ta" || v.startsWith("ta-") || v === "tamil") return "ta";
  if (v === "hi" || v.startsWith("hi-") || v === "hindi") return "hi";
  if (v === "te" || v.startsWith("te-") || v === "telugu") return "te";
  if (v === "kn" || v.startsWith("kn-") || v === "kannada") return "kn";
  if (v === "ml" || v.startsWith("ml-") || v === "malayalam") return "ml";
  if (v === "mr" || v.startsWith("mr-") || v === "marathi") return "mr";
  if (v === "bn" || v.startsWith("bn-") || v === "bengali" || v === "bangla") return "bn";
  if (v === "gu" || v.startsWith("gu-") || v === "gujarati") return "gu";
  if (v === "pa" || v.startsWith("pa-") || v === "punjabi") return "pa";
  if (v.length === 2) return v;
  const base = v.split("-")[0]!;
  return base.length === 2 ? base : "en";
}

const LANG_LABEL: Record<string, string> = {
  en: "English",
  ta: "Tamil",
  hi: "Hindi",
  te: "Telugu",
  kn: "Kannada",
  ml: "Malayalam",
  mr: "Marathi",
  bn: "Bengali",
  gu: "Gujarati",
  pa: "Punjabi",
};

const LANG_KEY_TO_BCP47: Record<string, string> = {
  en: "en-IN",
  ta: "ta-IN",
  hi: "hi-IN",
  te: "te-IN",
  kn: "kn-IN",
  ml: "ml-IN",
  mr: "mr-IN",
  bn: "bn-IN",
  gu: "gu-IN",
  pa: "pa-IN",
};

const OPENING_HI: Record<string, string> = {
  en: "Hi",
  ta: "வணக்கம்",
  hi: "नमस्ते",
  te: "నమస్కారం",
  kn: "ನಮಸ್ಕಾರ",
  ml: "നമസ്കാരം",
  mr: "नमस्कार",
  bn: "নমস্কার",
  gu: "નમસ્તે",
  pa: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ",
};

/** One-word hello in the opening language — no purpose-of-call script. */
export function openingHello(langKey: string): string {
  return OPENING_HI[resolveOpeningLanguageKey(langKey)] ?? "Hi";
}

/**
 * Memory language_pref is stored as a short code (`ta`, `hi`) by
 * normalizeFactValue. Session start used to look up only English names
 * (`tamil`), so `ta` never remapped STT (call 20257 stayed en-IN).
 */
export function mapLanguagePrefToBcp47(raw: string | null | undefined): string | undefined {
  const v = (raw ?? "").trim();
  if (!v) return undefined;
  return LANG_KEY_TO_BCP47[resolveOpeningLanguageKey(v)];
}

/** Slightly slower TTS for the opening Welcome. Later turns keep Sound speed. */
export function resolveInboundGreetingTtsSpeed(agentSpeed: number | null | undefined): number {
  const base = typeof agentSpeed === "number" && Number.isFinite(agentSpeed) && agentSpeed > 0
    ? agentSpeed
    : 1;
  return Math.round(Math.max(0.7, Math.min(1.2, base * 0.85)) * 100) / 100;
}

/**
 * Resolve opening language for this call.
 * - Prefer caller memory language_pref when present
 * - Else the agent's STT / Language dropdown
 * - Else English when no language is set
 */
export function resolveCallOpeningLanguage(opts: {
  memoryLanguagePref?: string | null;
  agentLanguage?: string | null;
  languageAutoDetect?: boolean;
}): { key: string; label: string; source: "memory" | "english_default" | "agent" } {
  const mem = (opts.memoryLanguagePref ?? "").trim();
  if (mem) {
    const key = resolveOpeningLanguageKey(mem);
    return { key, label: LANG_LABEL[key] ?? key, source: "memory" };
  }
  const agentLang = (opts.agentLanguage ?? "").trim();
  if (agentLang) {
    const key = resolveOpeningLanguageKey(agentLang);
    return { key, label: LANG_LABEL[key] ?? key, source: "agent" };
  }
  return { key: "en", label: "English", source: "english_default" };
}

/** Hardcoded language hint only — no inbound/outbound phrasebook. */
export function buildOpeningLanguageRule(opts: {
  memoryLanguagePref?: string | null;
  agentLanguage?: string | null;
  languageAutoDetect?: boolean;
}): string {
  const lang = resolveCallOpeningLanguage(opts);
  const langSourceNote =
    lang.source === "memory"
      ? "from caller memory (language_pref)"
      : lang.source === "english_default"
        ? "default English (no language_pref in memory)"
        : "agent configured language";
  return (
    `[OPENING LANGUAGE]\n` +
    `Speak the opening in ${lang.label} (${langSourceNote}).\n` +
    `After the customer speaks, follow THEIR language if they switch.\n` +
    `Never invent a language the caller did not use or store.`
  );
}

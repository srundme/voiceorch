/**
 * Sarvam saaras:v3 / saaras:v3-realtime `mode` (final transcript only;
 * partials are always plain transcription).
 *
 * Explicit agent-config mode wins, except Tamil + leftover Mixed/`codemix`
 * is treated as `transcribe` (call 23956 wrote Tanglish). Use `translit` for
 * Latin letters on Tamil.
 *   https://docs.sarvam.ai/api/getting-started/models/saaras
 *   transcribe → native-script only (தமிழ் / हिंदी)
 *   translit   → Romanization (Tanglish / Hinglish in Latin letters)
 *   codemix    → native + English  (मेरा phone number है 9840…)
 *
 * Default: English / auto / unknown → `codemix` so English words stay Latin.
 * Pinned Indic (ta-IN, hi-IN, …) → `transcribe` so Tamil/Hindi speech is
 * written in native script, not Tanglish. Call 23956: Tamil (India) + implicit
 * `codemix` wrote "Kadaikkara Than Pakkaran" instead of கடைக்காக. Pick Mixed
 * in the builder only when the agent must keep Hinglish/Tanglish spelling.
 *
 * Only saaras:v3 supports `mode` — the caller gates on MODE_CAPABLE.
 */

export type SarvamSttMode = "transcribe" | "codemix" | "verbatim" | "translit" | "translate";

const VALID_MODES = new Set<string>(["transcribe", "codemix", "verbatim", "translit", "translate"]);

function isTamilLanguage(languageCode: string | null | undefined): boolean {
  const lang = (languageCode ?? "").toLowerCase();
  return lang === "ta" || lang.startsWith("ta-");
}

export function resolveSarvamSttMode(
  languageCode: string | null | undefined,
  explicitMode?: string | null,
): SarvamSttMode {
  if (explicitMode && VALID_MODES.has(explicitMode)) {
    // The builder used to default Mixed (`codemix`) for every language. On a
    // Tamil-pinned agent that writes Tanglish (call 23956). Native script is
    // the Tamil default; pick `translit` if Latin letters are actually wanted.
    if (explicitMode === "codemix" && isTamilLanguage(languageCode)) {
      return "transcribe";
    }
    return explicitMode as SarvamSttMode;
  }
  const lang = (languageCode ?? "").toLowerCase();
  if (!lang || lang === "auto" || lang === "unknown" || lang.startsWith("en")) {
    return "codemix";
  }
  return "transcribe";
}

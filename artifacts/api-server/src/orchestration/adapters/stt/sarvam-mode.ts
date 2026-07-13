/**
 * Sarvam saaras:v3 STT mode resolution.
 *
 * `codemix` is ideal for Tamil/Hindi/etc. callers who mix English, but on
 * `en-IN` it often transcribes clear English as Indic script — use `transcribe`.
 */

export type SarvamSttMode = "transcribe" | "codemix" | "verbatim" | "translit";

const VALID_MODES = new Set<string>(["transcribe", "codemix", "verbatim", "translit"]);

/** Indic languages where codemix handles natural English mixing. */
const CODEMIX_LANGS = new Set([
  "ta", "hi", "te", "kn", "ml", "mr", "bn", "gu", "pa", "od", "or",
]);

export function resolveSarvamSttMode(
  languageCode: string | null | undefined,
  explicitMode?: string | null,
): SarvamSttMode {
  if (explicitMode && VALID_MODES.has(explicitMode)) {
    return explicitMode as SarvamSttMode;
  }
  const bare = (languageCode ?? "en-IN").split("-")[0]?.toLowerCase() ?? "en";
  if (bare === "en") return "transcribe";
  if (CODEMIX_LANGS.has(bare)) return "codemix";
  return "transcribe";
}

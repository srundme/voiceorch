/**
 * Sarvam saaras:v3 STT mode resolution.
 *
 * Explicit agent-config mode ALWAYS wins. Default is `codemix` for every
 * language — Indian voice calls mix English (API, B2B, current price) with
 * Indic, and pinning `transcribe` + a single language_code made those turns
 * vanish from the transcript (call 12855: VAD kept firing, STT went silent).
 *
 * Pick `transcribe` in the builder only when you want every word in native
 * script. The five saaras modes stay available as explicit overrides.
 *
 * Only saaras:v3 supports `mode` at all — the caller gates on MODE_CAPABLE.
 */

export type SarvamSttMode = "transcribe" | "codemix" | "verbatim" | "translit" | "translate";

const VALID_MODES = new Set<string>(["transcribe", "codemix", "verbatim", "translit", "translate"]);

export function resolveSarvamSttMode(
  _languageCode: string | null | undefined,
  explicitMode?: string | null,
): SarvamSttMode {
  if (explicitMode && VALID_MODES.has(explicitMode)) {
    return explicitMode as SarvamSttMode;
  }
  return "codemix";
}

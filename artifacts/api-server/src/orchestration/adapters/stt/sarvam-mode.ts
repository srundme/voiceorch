/**
 * Sarvam saaras:v3 / saaras:v3-realtime `mode` (final transcript only;
 * partials are always plain transcription).
 *
 * Explicit agent-config mode ALWAYS wins. Default is `codemix`:
 *   https://docs.sarvam.ai/api/getting-started/models/saaras
 *   transcribe → native-script only (मेरा फोन नंबर है 9840…)
 *   codemix    → native + English  (मेरा phone number है 9840…)
 *
 * Indian voice calls are code-mix heavy (API, B2B, current price). Sarvam's
 * own guidance: use codemix for that, not transcribe. transcribe on a Hindi
 * pin wrote "करंट प्राइस" then later mixed turns produced empty finals
 * (call 12855). Pick `transcribe` in the builder only for native-script records.
 *
 * Only saaras:v3 supports `mode` — the caller gates on MODE_CAPABLE.
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

/**
 * Sarvam saaras:v3 STT mode resolution.
 *
 * Explicit agent-config mode ALWAYS wins. Defaults otherwise:
 *   • en-IN (and the multilingual default)  → `codemix` — natural for English
 *     with surprise Hindi/Tamil mixing: English words stay in English script.
 *   • EVERY Indic language                  → `transcribe` — clean native-script
 *     output (e.g. ஃபீச்சர்ஸ் for "features") without phonetic English mangling
 *     ("Futures-ல"). Per Sarvam's guidance, `transcribe` is the mode for clean
 *     native-script records; codemix on a known-Indic call can write English
 *     speech in the Indic script.
 *
 * Previously only 8 of the 22 Indic languages were pattern-matched here, so
 * od-IN, pa-IN and all saaras:v3-only languages (ur-IN, ne-IN, as-IN, …)
 * silently fell through to codemix. The rule is now uniform: en → codemix,
 * anything else → transcribe.
 *
 * Only saaras:v3 supports `mode` at all — the caller gates on MODE_CAPABLE.
 */

export type SarvamSttMode = "transcribe" | "codemix" | "verbatim" | "translit";

const VALID_MODES = new Set<string>(["transcribe", "codemix", "verbatim", "translit"]);

export function resolveSarvamSttMode(
  languageCode: string | null | undefined,
  explicitMode?: string | null,
): SarvamSttMode {
  if (explicitMode && VALID_MODES.has(explicitMode)) {
    return explicitMode as SarvamSttMode;
  }
  const lang = (languageCode ?? "en-IN").toLowerCase();
  return lang.startsWith("en") ? "codemix" : "transcribe";
}
